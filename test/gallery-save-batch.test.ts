import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GALLERY_MAX_ITEMS, getGallery, saveGallery } from "../worker/galleries";

const USER = "u1";

/**
 * Counts D1 round trips the way production bills them: each `run` / `all` / `first`
 * is its own request, and one `batch()` is one request no matter how many statements it holds.
 */
function openDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  raw.prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`).run(USER);

  let solo = 0;
  let batches = 0;
  let batched = 0;
  let inBatch = false;
  const statement = (sql: string, args: unknown[]) => ({
    async first() {
      if (inBatch) batched += 1;
      else solo += 1;
      return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
    },
    async all() {
      if (inBatch) batched += 1;
      else solo += 1;
      return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
    },
    async run() {
      if (inBatch) batched += 1;
      else solo += 1;
      raw.prepare(sql).run(...(args as (string | number | null)[]));
      return { success: true };
    },
  });
  const db = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => statement(sql, args) };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      batches += 1;
      inBatch = true;
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      } finally {
        inBatch = false;
      }
    },
  } as unknown as D1Database;
  return {
    db,
    take() {
      const snap = { solo, batches, batched };
      solo = 0;
      batches = 0;
      batched = 0;
      return snap;
    },
  };
}

function image(name: string, role: "character" | "background" | "object" | "style" = "character", label: string | null = null) {
  return { kind: "image" as const, name, key: `u/${USER}/galleries/${name}`, role, label };
}

describe("gallery save round trips", () => {
  it("rewrites a full gallery in one batch and keeps order when an item is added", async () => {
    const harness = openDb();
    const first = [
      image("room.png", "background", "wide"),
      image("face.png", "character"),
      image("prop.png", "object", "lamp"),
    ];
    const created = await saveGallery(harness.db, USER, { name: "Refs", items: first });
    expect(created?.items.map((item) => item.name)).toEqual(["room.png", "face.png", "prop.png"]);
    harness.take();

    const added = [...first, image("clip-tone.png", "style")];
    const saved = await saveGallery(harness.db, USER, {
      id: created!.id,
      name: "Refs",
      items: added,
    });
    const cost = harness.take();
    // The delete and every insert share one round trip. The other requests read the
    // gallery, check the handle against galleries and slots, and update the row.
    expect(cost.batches).toBe(1);
    expect(cost.batched).toBe(1 + added.length);
    expect(cost.solo).toBeLessThanOrEqual(6);

    const loaded = await getGallery(harness.db, USER, created!.id);
    expect(loaded?.items.map((item) => [item.name, item.role, item.label, item.position])).toEqual([
      ["room.png", "background", "wide", 0],
      ["face.png", "character", null, 1],
      ["prop.png", "object", "lamp", 2],
      ["clip-tone.png", "style", null, 3],
    ]);
    expect(saved?.items.map((item) => item.key)).toEqual(loaded?.items.map((item) => item.key));

    harness.take();
    const full = Array.from({ length: GALLERY_MAX_ITEMS }, (_, index) =>
      image(`shot-${index}.png`, index % 2 === 0 ? "character" : "background"),
    );
    await saveGallery(harness.db, USER, { id: created!.id, name: "Refs", items: full });
    const fullCost = harness.take();
    expect(fullCost.batches).toBe(1);
    expect(fullCost.batched).toBe(1 + GALLERY_MAX_ITEMS);
    expect(fullCost.solo).toBeLessThanOrEqual(6);
    const reread = await getGallery(harness.db, USER, created!.id);
    expect(reread?.items).toHaveLength(GALLERY_MAX_ITEMS);
    expect(reread?.items[0]?.name).toBe("shot-0.png");
    expect(reread?.items[95]?.name).toBe("shot-95.png");
    expect(reread?.items[1]?.role).toBe("background");
  });
});
