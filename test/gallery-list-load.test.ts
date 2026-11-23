import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import { GALLERY_MAX_ITEMS, saveGallery } from "../worker/galleries";
import { presentGalleryList } from "../worker/gallery-present";
import { app } from "../worker/index";
import type { Env } from "../worker/types";
import { createMockR2, TEST_SESSION_ID } from "./helpers";

const USER = "u1";
const PROFILE = "profile-1";
const OTHER_PROFILE = "profile-2";
/** D1 refuses a Worker invocation once more than six of its queries are in flight. */
const D1_CONNECTIONS = 6;

type LoadStats = {
  calls: number;
  maxInFlight: number;
  arm(): void;
};

/**
 * Real SQLite behind a D1-shaped client. Once armed, each query yields so overlapping
 * calls are visible, and a seventh in-flight query is refused the way D1 refuses it.
 */
function openDb(options: { before?: string } = {}): { raw: DatabaseSync; env: Env; db: D1Database; stats: LoadStats } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !options.before || name < options.before)
    .sort();
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  raw.prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`).run(USER);
  const insertProfile = raw.prepare(
    `INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insertProfile.run(PROFILE, USER, "Personal", 1, 1);
  insertProfile.run(OTHER_PROFILE, USER, "Work", 100, 100);
  raw
    .prepare(
      `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, history_page_size, active_profile_id, updated_at)
       VALUES (?, '{}', '{}', 36, ?, 1)`,
    )
    .run(USER, PROFILE);

  let armed = false;
  let inFlight = 0;
  const stats: LoadStats = {
    calls: 0,
    maxInFlight: 0,
    arm() {
      armed = true;
      inFlight = 0;
      stats.calls = 0;
      stats.maxInFlight = 0;
    },
  };

  async function track<T>(run: () => T): Promise<T> {
    if (!armed) return run();
    inFlight += 1;
    stats.calls += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    if (inFlight > D1_CONNECTIONS) {
      inFlight -= 1;
      throw new Error("D1_ERROR: too many simultaneous connections");
    }
    await Promise.resolve();
    try {
      return run();
    } finally {
      inFlight -= 1;
    }
  }

  // node:sqlite says "no column named label". D1 says "no such column: label", which is what the fallbacks match.
  const asD1 = (err: unknown): never => {
    const message = err instanceof Error ? err.message : String(err);
    const named = /no column named (\w+)/.exec(message);
    if (named) throw new Error(`D1_ERROR: no such column: ${named[1]}`);
    throw err instanceof Error ? err : new Error(message);
  };
  const statement = (sql: string, args: unknown[]) => ({
    first: () =>
      track(() => {
        // Route tests sign in without a real GitHub session row.
        if (sql.includes("FROM sessions")) {
          return args[0] === TEST_SESSION_ID
            ? { id: USER, github_id: 1, login: "ada", name: "Ada", avatar_url: null, created_at: 1, updated_at: 1 }
            : null;
        }
        try {
          return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
        } catch (err) {
          asD1(err);
        }
      }),
    all: () =>
      track(() => {
        try {
          return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
        } catch (err) {
          asD1(err);
        }
      }),
    run: () =>
      track(() => {
        try {
          raw.prepare(sql).run(...(args as (string | number | null)[]));
        } catch (err) {
          asD1(err);
        }
        return { success: true };
      }),
  });
  const db = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => statement(sql, args),
        ...statement(sql, []),
      };
    },
    batch(statements: { run(): Promise<unknown> }[]) {
      return track(() => {
        raw.exec("BEGIN");
        try {
          const results: unknown[] = [];
          for (const item of statements) results.push(item.run());
          raw.exec("COMMIT");
          return Promise.all(results);
        } catch (err) {
          raw.exec("ROLLBACK");
          throw err;
        }
      });
    },
  } as unknown as D1Database;
  const { bucket } = createMockR2();
  const env = {
    DB: db,
    MEDIA: bucket,
    PUBLIC_BASE_URL: "https://studio.test",
    ENCRYPTION_KEY: "test-encryption-key",
    MEDIA_SIGNING_KEY: "test-signing-key",
    SESSION_SECRET: "session-secret",
    SESSION_TTL_SECONDS: "604800",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    GITHUB_ORG: "",
    GITHUB_ADMINS: "ada",
  } as unknown as Env;
  return { raw, env, db, stats };
}

function image(name: string, role: "character" | "background" = "character", label: string | null = null) {
  return { kind: "image" as const, name, key: `u/${USER}/${name}`, role, label };
}

async function save(db: D1Database, name: string, items: unknown[], profileId = PROFILE) {
  const saved = await saveGallery(db, USER, { name, items, profileId, handle: "" });
  if (!saved) throw new Error(`gallery ${name} not saved`);
  return saved.id;
}

describe("gallery list load", () => {
  it("reads a full profile in a handful of queries, never more than D1 will run at once", async () => {
    const { env, db, stats } = openDb();
    const full = Array.from({ length: GALLERY_MAX_ITEMS }, (_, index) =>
      image(
        `frame-${String(index).padStart(3, "0")}.png`,
        index % 3 === 0 ? "character" : "background",
        index < 4 ? `L${index}` : null,
      ),
    );
    const fullId = await save(db, "Fullset", full);
    await save(db, "Clips", [{ kind: "video", name: "clip.mp4", key: `u/${USER}/clip.mp4`, role: null, label: null }]);
    await save(db, "Takes", [{ kind: "audio", name: "take.mp3", key: `u/${USER}/take.mp3`, role: null, label: null }]);
    for (let index = 0; index < 21; index += 1) {
      await save(db, `Set${index}`, [image(`set-${index}-a.png`), image(`set-${index}-b.png`, "background")]);
    }
    await save(db, "Workset", [image("work.png")], OTHER_PROFILE);

    stats.arm();
    const listed = await presentGalleryList(env, USER, "", PROFILE);

    expect(stats.maxInFlight).toBeLessThanOrEqual(1);
    // One list, one item read, and a couple of thumbnail lookups. The old path opened
    // two queries per gallery at the same time, which is about fifty requests here.
    expect(stats.calls).toBeLessThan(12);
    expect(listed.map((gallery) => gallery.name)).not.toContain("Workset");
    expect(listed).toHaveLength(24);

    const fullCard = listed.find((gallery) => gallery.id === fullId);
    expect(fullCard?.count).toBe(GALLERY_MAX_ITEMS);
    expect(fullCard?.items.map((item) => item.name)).toEqual(full.map((item) => item.name));
    expect(fullCard?.items[0]).toMatchObject({ role: "character", label: "L0" });
    expect(fullCard?.items[1]).toMatchObject({ role: "background", label: "L1" });
    expect(fullCard?.items[4]).toMatchObject({ role: "background", label: null });
    expect(listed.find((gallery) => gallery.name === "Clips")?.items[0]?.kind).toBe("video");
    expect(listed.find((gallery) => gallery.name === "Takes")?.items[0]?.kind).toBe("audio");
    expect(listed.find((gallery) => gallery.name === "Set0")?.items.map((item) => item.role)).toEqual([
      "character",
      "background",
    ]);
  });

  it("still lists items when the database has no label column", async () => {
    const { env, db, stats } = openDb({ before: "0028" });
    await save(db, "Heads", [image("head.png", "character")]);
    await save(db, "Rooms", [image("room.png", "background")]);
    stats.arm();
    const listed = await presentGalleryList(env, USER, "", PROFILE);
    expect(stats.maxInFlight).toBeLessThanOrEqual(1);
    expect(listed.map((gallery) => gallery.name).sort()).toEqual(["Heads", "Rooms"]);
    expect(listed.find((gallery) => gallery.name === "Heads")?.items[0]).toMatchObject({
      role: "character",
      label: null,
    });
    expect(listed.find((gallery) => gallery.name === "Rooms")?.items[0]).toMatchObject({
      role: "background",
      label: null,
    });
  });

  it("serves the list and an opened gallery over HTTP", async () => {
    const { env, db, stats } = openDb();
    const full = Array.from({ length: GALLERY_MAX_ITEMS }, (_, index) => image(`shot-${index}.png`));
    const id = await save(db, "Fullset", full);
    await save(db, "Workset", [image("work.png")], OTHER_PROFILE);
    stats.arm();
    const cookie = `${SESSION_COOKIE}=${TEST_SESSION_ID}`;
    const list = await app.request(
      "https://studio.test/api/galleries",
      { headers: { Cookie: cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      galleries: Array<{ id: string; name: string; count: number; items: Array<{ name: string }> }>;
    };
    expect(body.galleries.map((gallery) => gallery.name)).toEqual(["Fullset"]);
    expect(body.galleries[0]?.count).toBe(GALLERY_MAX_ITEMS);
    expect(body.galleries[0]?.items).toHaveLength(GALLERY_MAX_ITEMS);

    const opened = await app.request(
      `https://studio.test/api/galleries/${id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(opened.status).toBe(200);
    const detail = (await opened.json()) as { gallery: { id: string; items: Array<{ name: string; position: number }> } };
    expect(detail.gallery.id).toBe(id);
    expect(detail.gallery.items.map((item) => item.name)).toEqual(full.map((item) => item.name));
    expect(detail.gallery.items.map((item) => item.position)).toEqual(full.map((_, index) => index));
    expect(stats.maxInFlight).toBeLessThanOrEqual(D1_CONNECTIONS);
  });
});
