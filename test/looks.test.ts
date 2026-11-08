import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  acceptAppliedLooks,
  acceptLookIds,
  appliedLooks,
  cappedLookIds,
  joinLooks,
  lookSections,
  looksFromParams,
  lookSentence,
  PROJECT_LOOKS_MAX,
  toggleLookId,
  type Look,
} from "../worker/looks";
import { composeModelPrompt } from "../src/lib/model-prompt";
import { paramsJsonForStorage } from "../worker/oxen";
import { ensureLooksSchema } from "../worker/looks-migration";
import { deleteStyle, getProject, listStyles, updateProject, updateStyle } from "../worker/projects";

function look(id: string, body: string, extra: Partial<Look> = {}): Look {
  return { id, name: id.toUpperCase(), body, group: null, starred: false, ...extra };
}

describe("look sentences", () => {
  it("trims and ends each body with a period", () => {
    expect(lookSentence("  Shot on 35mm  ")).toBe("Shot on 35mm.");
    expect(lookSentence("Kodak Portra, warm skin.")).toBe("Kodak Portra, warm skin.");
    expect(lookSentence("Why so blue?")).toBe("Why so blue?");
    expect(lookSentence("Fade to black…")).toBe("Fade to black…");
    expect(lookSentence("   ")).toBe("");
  });

  it("joins applied looks in chip order ahead of the prompt", () => {
    const collection = [
      look("era", "A 1970s look, faded print"),
      look("cam", "Shot on 35mm"),
      look("light", "Soft window light."),
    ];
    const applied = appliedLooks(["cam", "light", "era"], collection);
    expect(applied.map((item) => item.id)).toEqual(["cam", "light", "era"]);
    const block = joinLooks(applied);
    expect(block).toBe("Shot on 35mm. Soft window light. A 1970s look, faded print.");
    expect(composeModelPrompt("Hold still.", block, "")).toBe(
      "Shot on 35mm. Soft window light. A 1970s look, faded print.\n\nHold still.",
    );
  });

  it("skips ids that are no longer in the collection", () => {
    const applied = appliedLooks(["gone", "cam"], [look("cam", "Shot on 35mm")]);
    expect(applied.map((item) => item.id)).toEqual(["cam"]);
  });
});

describe("five looks per project", () => {
  it("caps the applied set and keeps the first five in order", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    expect(cappedLookIds(ids)).toEqual(["a", "b", "c", "d", "e"]);
    expect(cappedLookIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(acceptLookIds(ids)).toEqual(["a", "b", "c", "d", "e"]);
    expect(acceptLookIds(undefined)).toEqual([]);
    expect(acceptLookIds("a")).toBeNull();
    expect(acceptLookIds(["a", 3])).toBeNull();
  });

  it("toggles chips and refuses a sixth", () => {
    let ids: string[] = [];
    for (const id of ["a", "b", "c", "d", "e"]) ids = toggleLookId(ids, id);
    expect(ids).toHaveLength(PROJECT_LOOKS_MAX);
    expect(toggleLookId(ids, "f")).toEqual(ids);
    expect(toggleLookId(ids, "c")).toEqual(["a", "b", "d", "e"]);
  });

  it("joins at most five bodies", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => look(id, id));
    expect(joinLooks(six)).toBe("a. b. c. d. e.");
  });
});

describe("look picker order", () => {
  it("lists starred first, then groups in order, then ungrouped, searching name and body", () => {
    const collection = [
      look("z", "zoom lens", { name: "Zoom", group: "Camera" }),
      look("w", "warm tungsten", { name: "Warm", group: "Light" }),
      look("v", "vhs grain", { name: "VHS", group: "Era", starred: true }),
      look("u", "untitled mood", { name: "Mood" }),
      look("a", "anamorphic flares", { name: "Anamorphic", group: "Camera" }),
    ];
    const sections = lookSections(collection);
    expect(sections.map((section) => section.label)).toEqual(["Starred", "Camera", "Light", "No group"]);
    expect(sections[1]?.looks.map((item) => item.name)).toEqual(["Anamorphic", "Zoom"]);
    const found = lookSections(collection, "grain");
    expect(found).toHaveLength(1);
    expect(found[0]?.looks.map((item) => item.id)).toEqual(["v"]);
  });
});

describe("looks recorded with a generation", () => {
  it("keeps ids and names only, capped at five", () => {
    const raw = [
      { id: "a", name: "Anamorphic" },
      { id: "a", name: "Dup" },
      { id: "b", name: "" },
      { id: "c", name: "Cool", body: "data:image/png;base64,AAAA" },
      "junk",
      { id: "d", name: "D" },
      { id: "e", name: "E" },
      { id: "f", name: "F" },
      { id: "g", name: "G" },
    ];
    expect(acceptAppliedLooks(raw)).toEqual([
      { id: "a", name: "Anamorphic" },
      { id: "c", name: "Cool" },
      { id: "d", name: "D" },
      { id: "e", name: "E" },
      { id: "f", name: "F" },
    ]);
  });

  it("survives the stored params, including the slimmed fallback", () => {
    const looks = [{ id: "a", name: "Anamorphic" }];
    const json = paramsJsonForStorage({ model: "m", prompt: "p", studio_looks: looks });
    expect(looksFromParams(json)).toEqual(looks);
    const huge = paramsJsonForStorage({
      model: "m",
      prompt: "x".repeat(2_100_000),
      studio_looks: looks,
    });
    expect(looksFromParams(huge)).toEqual(looks);
    expect(looksFromParams(null)).toEqual([]);
    expect(looksFromParams("{not json")).toEqual([]);
  });
});

describe("look storage", () => {
  function sqliteD1(): { raw: DatabaseSync; db: D1Database } {
    const raw = new DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0009_galleries.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0022_projects.sql", import.meta.url), "utf8"));
    const statement = (sql: string, args: unknown[]) => ({
      async first() {
        return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
      },
      async all() {
        return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
      },
      async run() {
        const info = raw.prepare(sql).run(...(args as (string | number | null)[]));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    });
    const db = {
      prepare(sql: string) {
        return { bind: (...args: unknown[]) => statement(sql, args), ...statement(sql, []) };
      },
      async batch(statements: { run(): Promise<unknown> }[]) {
        for (const item of statements) await item.run();
        return [];
      },
    } as unknown as D1Database;
    return { raw, db };
  }

  it("migrates the single default look into the first chip and keeps chip order", async () => {
    const { raw, db } = sqliteD1();
    raw.exec(
      `INSERT INTO styles (id, user_id, profile_id, name, body, created_at, updated_at)
         VALUES ('s1', 'u1', 'p1', 'Old', 'Shot on 35mm', 1, 1), ('s2', 'u1', 'p1', 'New', 'Soft light', 2, 2),
                ('s3', 'u1', 'p1', 'Third', 'Faded print', 3, 3), ('s4', 'u1', 'p1', 'Fourth', 'Grain', 4, 4),
                ('s5', 'u1', 'p1', 'Fifth', 'Teal shadows', 5, 5), ('s6', 'u1', 'p1', 'Sixth', 'Dolly in', 6, 6);
       INSERT INTO projects (id, user_id, profile_id, name, prompt, style_id, created_at, updated_at)
         VALUES ('pr1', 'u1', 'p1', 'Clip', 'Hold still.', 's1', 1, 1);`,
    );
    raw.exec(readFileSync(new URL("../migrations/0024_looks.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0025_project_cast.sql", import.meta.url), "utf8"));
    const env = { DB: db } as unknown as Parameters<typeof getProject>[0];
    const migrated = await getProject(env, "u1", "pr1");
    expect(migrated?.lookIds).toEqual(["s1"]);

    const looks = await listStyles(db, "u1", "p1");
    expect(looks.map((item) => item.group)).toEqual([null, null, null, null, null, null]);
    expect(looks.every((item) => !item.starred)).toBe(true);

    const saved = await updateProject(db, "u1", "pr1", {
      name: "Clip",
      prompt: "Hold still.",
      lookIds: ["s3", "s1", "s2", "s4", "s5", "s6"],
      budget: 20,
      cast: [],
    });
    expect(saved).toBe(true);
    const reordered = await getProject(env, "u1", "pr1");
    expect(reordered?.lookIds).toEqual(["s3", "s1", "s2", "s4", "s5"]);
    expect(raw.prepare(`SELECT style_id FROM projects WHERE id = 'pr1'`).get()).toEqual({ style_id: "s3" });

    const starred = await updateStyle(db, "u1", "s2", { starred: true, group: "Light" });
    expect(starred).toMatchObject({ id: "s2", starred: true, group: "Light" });
    expect((await listStyles(db, "u1", "p1"))[0]?.id).toBe("s2");

    expect(await deleteStyle(db, "u1", "s3")).toBe(true);
    const afterDelete = await getProject(env, "u1", "pr1");
    expect(afterDelete?.lookIds).toEqual(["s1", "s2", "s4", "s5"]);

    const foreign = await updateProject(db, "u1", "pr1", {
      name: "Clip",
      prompt: "Hold still.",
      lookIds: ["not-mine"],
      budget: 20,
      cast: [],
    });
    expect(foreign).toBe(false);
  });
});

describe("looks schema from the Worker", () => {
  it("applies 0024 once on a database that stopped at 0023 and records it", async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0009_galleries.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0022_projects.sql", import.meta.url), "utf8"));
    raw.exec(
      `CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
       INSERT INTO styles (id, user_id, profile_id, name, body, created_at, updated_at) VALUES ('s1', 'u1', 'p1', 'Old', 'Shot on 35mm', 1, 1);
       INSERT INTO projects (id, user_id, profile_id, name, prompt, style_id, created_at, updated_at) VALUES ('pr1', 'u1', 'p1', 'Clip', '', 's1', 1, 1);
       INSERT INTO project_sessions (id, project_id, user_id, name, prompt, style_id, mode, model, params_json, attachments_json, created_at, updated_at)
         VALUES ('se1', 'pr1', 'u1', 'Take', '', 's1', NULL, '', '{}', '[]', 1, 1);`,
    );
    const statement = (sql: string, args: unknown[]) => ({
      async first() {
        return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
      },
      async all() {
        return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
      },
      async run() {
        raw.prepare(sql).run(...(args as (string | number | null)[]));
        return { success: true, meta: { changes: 0 } };
      },
    });
    const db = {
      prepare(sql: string) {
        return { bind: (...args: unknown[]) => statement(sql, args), ...statement(sql, []) };
      },
    } as unknown as D1Database;

    await ensureLooksSchema(db);
    await ensureLooksSchema(db);
    expect(raw.prepare(`SELECT name FROM d1_migrations`).all()).toEqual([{ name: "0024_looks.sql" }]);
    expect(raw.prepare(`SELECT project_id, style_id, position FROM project_looks`).all()).toEqual([
      { project_id: "pr1", style_id: "s1", position: 0 },
    ]);
    expect(raw.prepare(`SELECT group_name, starred FROM styles WHERE id = 's1'`).get()).toEqual({
      group_name: null,
      starred: 0,
    });
    expect(raw.prepare(`SELECT look_ids_json FROM project_sessions WHERE id = 'se1'`).get()).toEqual({
      look_ids_json: '["s1"]',
    });
  });
});
