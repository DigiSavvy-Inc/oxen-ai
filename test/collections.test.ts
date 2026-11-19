import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import {
  collectionAssets,
  createCollection,
  deleteCollection,
  fileGallery,
  listCollections,
  orderCollectionGalleries,
  orderCollections,
  parseCollectionAssetsQuery,
  updateCollection,
} from "../worker/collections";
import { deleteGallery, getGallery, listGalleries, saveGallery } from "../worker/galleries";
import { deleteGalleryFiles } from "../worker/gallery-delete";
import { COLLECTION_MAX_PER_PROFILE } from "../worker/gallery-limits";
import { presentGalleryList } from "../worker/gallery-present";
import { app } from "../worker/index";
import { deleteAllUserMedia } from "../worker/library";
import { createSlot, listSlots } from "../worker/slots";
import type { Env } from "../worker/types";
import { createMockR2, TEST_SESSION_ID } from "./helpers";

const USER = "u1";
const PROFILE = "profile-1";
const OTHER_PROFILE = "profile-2";

/** A real SQLite database with every migration, or every migration before collections. */
function openDb(options: { withoutCollections?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !(options.withoutCollections && name >= "0032"))
    .sort();
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  raw
    .prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`)
    .run(USER);
  const insertProfile = raw.prepare(
    `INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insertProfile.run(PROFILE, USER, "Personal", 1, 1);
  insertProfile.run(OTHER_PROFILE, USER, "Work", 100, 100);
  raw
    .prepare(
      `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, history_page_size, active_profile_id, updated_at)
       VALUES (?, '{}', '{}', 12, ?, 1)`,
    )
    .run(USER, PROFILE);
  const statement = (sql: string, args: unknown[]) => ({
    async first() {
      // Route tests sign in without a real GitHub session.
      if (sql.includes("FROM sessions")) {
        return args[0] === TEST_SESSION_ID
          ? { id: USER, github_id: 1, login: "ada", name: "Ada", avatar_url: null, created_at: 1, updated_at: 1 }
          : null;
      }
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
    // D1 runs a batch as one transaction: a failing statement rolls back the ones before it.
    async batch(statements: { run(): Promise<unknown> }[]) {
      raw.exec("BEGIN");
      try {
        const results: unknown[] = [];
        for (const item of statements) results.push(await item.run());
        raw.exec("COMMIT");
        return results;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
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
  return { raw, env, db };
}

function image(name: string, role = "character", label: string | null = null) {
  return { kind: "image" as const, name, key: `u/${USER}/${name}`, role, label };
}

function video(name: string) {
  return { kind: "video" as const, name, key: `u/${USER}/${name}`, role: "background", label: null };
}

function audio(name: string) {
  return { kind: "audio" as const, name, key: `u/${USER}/${name}`, role: null, label: null };
}

async function gallery(db: D1Database, name: string, items: unknown[], profileId = PROFILE): Promise<string> {
  const saved = await saveGallery(db, USER, { name, items, profileId, handle: "" });
  if (!saved) throw new Error("gallery not saved");
  return saved.id;
}

async function collection(db: D1Database, name: string, profileId: string = PROFILE): Promise<string> {
  const made = await createCollection(db, USER, profileId, name);
  if ("error" in made) throw new Error(made.error);
  return made.id;
}

async function listed(env: Env, profileId: string = PROFILE) {
  return (await listCollections(env, USER, profileId)).collections;
}

describe("collections storage", () => {
  it("starts every existing gallery ungrouped once the migration lands", async () => {
    const { env, db } = openDb();
    const id = await gallery(db, "Maya", [image("a.png")]);
    expect(await listCollections(env, USER, PROFILE)).toEqual({ collections: [], ready: true });
    const [summary] = await listGalleries(db, USER, "", PROFILE);
    expect(summary).toMatchObject({ id, collectionId: null });
  });

  it("creates, renames, reorders, and deletes, and every change reads back", async () => {
    const { env, db } = openDb();
    const a = await collection(db, "Maya");
    const b = await collection(db, "Client");
    const c = await collection(db, "Shoot");
    expect((await listed(env)).map((row) => row.name)).toEqual(["Maya", "Client", "Shoot"]);

    expect(await updateCollection(db, USER, PROFILE, b, { name: "  Acme  " })).toEqual({ id: b });
    expect(await updateCollection(db, USER, PROFILE, b, { name: "x".repeat(81) })).toEqual({ error: "name" });
    expect(await createCollection(db, USER, PROFILE, "   ")).toEqual({ error: "name" });

    expect(await orderCollections(db, USER, PROFILE, [c, a, "nope"])).toEqual({ ids: [c, a, b] });
    expect((await listed(env)).map((row) => row.name)).toEqual(["Shoot", "Maya", "Acme"]);
    expect(await orderCollections(db, USER, PROFILE, "nope")).toEqual({ error: "order" });

    const g1 = await gallery(db, "Faces", [image("face.png")]);
    await fileGallery(db, USER, PROFILE, g1, a);
    expect(await deleteCollection(db, USER, PROFILE, a)).toEqual({ ungrouped: 1 });
    expect((await listed(env)).map((row) => row.name)).toEqual(["Shoot", "Acme"]);
    expect(await deleteCollection(db, USER, PROFILE, a)).toEqual({ error: "missing" });
  });

  it("deletes a collection without touching its galleries or files", async () => {
    const { db } = openDb();
    const shoot = await collection(db, "Shoot");
    const g1 = await gallery(db, "Day 1", [image("one.png"), image("two.png")]);
    const g2 = await gallery(db, "Day 2", [image("three.png")]);
    await fileGallery(db, USER, PROFILE, g1, shoot);
    await fileGallery(db, USER, PROFILE, g2, shoot);
    expect(await deleteCollection(db, USER, PROFILE, shoot)).toEqual({ ungrouped: 2 });
    const galleries = await listGalleries(db, USER, "", PROFILE);
    expect(galleries.map((row) => [row.name, row.collectionId])).toEqual(
      expect.arrayContaining([
        ["Day 1", null],
        ["Day 2", null],
      ]),
    );
    expect((await getGallery(db, USER, g1))?.items.map((item) => item.name)).toEqual(["one.png", "two.png"]);
    expect((await getGallery(db, USER, g2))?.items.map((item) => item.name)).toEqual(["three.png"]);
  });

  it("deletes a collection all at once: if the row cannot go, its galleries stay filed", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    const g1 = await gallery(db, "Day 1", [image("one.png")]);
    await fileGallery(db, USER, PROFILE, g1, shoot);
    const failing = {
      ...db,
      prepare(sql: string) {
        if (!sql.startsWith("DELETE FROM collections")) return db.prepare(sql);
        const broken = { run: async () => Promise.reject(new Error("D1 went away")) };
        return { ...broken, bind: () => broken };
      },
    } as unknown as D1Database;
    await expect(deleteCollection(failing, USER, PROFILE, shoot)).rejects.toThrow("D1 went away");
    expect((await listed(env)).map((row) => [row.name, row.galleryIds])).toEqual([["Shoot", [g1]]]);
  });

  it("keeps a gallery in at most one collection: filing it again moves it to the end of the new one", async () => {
    const { env, db } = openDb();
    const a = await collection(db, "A");
    const b = await collection(db, "B");
    const g1 = await gallery(db, "One", [image("1.png")]);
    const g2 = await gallery(db, "Two", [image("2.png")]);
    await fileGallery(db, USER, PROFILE, g2, b);
    await fileGallery(db, USER, PROFILE, g1, a);
    expect(await fileGallery(db, USER, PROFILE, g1, b)).toEqual({ galleryId: g1, collectionId: b });
    const [first, second] = await listed(env);
    expect(first?.galleryIds).toEqual([]);
    expect(second?.galleryIds).toEqual([g2, g1]);
    expect(await fileGallery(db, USER, PROFILE, g1, null)).toEqual({ galleryId: g1, collectionId: null });
    expect((await listed(env))[1]?.galleryIds).toEqual([g2]);
  });

  it("files and unfiles without changing items, order, roles, labels, handle, take, or updated_at", async () => {
    const { raw, db } = openDb();
    const saved = await saveGallery(db, USER, {
      name: "Maya",
      handle: "Maya",
      takeCount: 3,
      profileId: PROFILE,
      items: [image("b.png", "background", "Room"), image("a.png", "object", "Hat"), audio("v.mp3")],
    });
    raw.prepare(`UPDATE galleries SET updated_at = 1234 WHERE id = ?`).run(saved!.id);
    const before = await getGallery(db, USER, saved!.id);
    const cast = await collection(db, "Cast");
    await fileGallery(db, USER, PROFILE, saved!.id, cast);
    expect(await getGallery(db, USER, saved!.id)).toEqual(before);
    await fileGallery(db, USER, PROFILE, saved!.id, null);
    const after = await getGallery(db, USER, saved!.id);
    expect(after).toEqual(before);
    expect(after?.updatedAt).toBe(1234);
    expect(after?.items.map((item) => [item.name, item.role, item.label])).toEqual([
      ["b.png", "background", "Room"],
      ["a.png", "object", "Hat"],
      ["v.mp3", null, null],
    ]);
  });

  it("orders galleries inside one collection and ignores ids that are not in it", async () => {
    const { env, db } = openDb();
    const cast = await collection(db, "Cast");
    const g1 = await gallery(db, "One", [image("1.png")]);
    const g2 = await gallery(db, "Two", [image("2.png")]);
    const g3 = await gallery(db, "Three", [image("3.png")]);
    const loose = await gallery(db, "Loose", [image("4.png")]);
    for (const id of [g1, g2, g3]) await fileGallery(db, USER, PROFILE, id, cast);
    expect(await orderCollectionGalleries(db, USER, PROFILE, cast, [g3, loose, g1])).toEqual({
      galleryIds: [g3, g1, g2],
    });
    expect((await listed(env))[0]?.galleryIds).toEqual([g3, g1, g2]);
    expect((await listGalleries(db, USER, "", PROFILE)).find((row) => row.id === loose)?.collectionId).toBeNull();
  });

  it("keeps collections on their profile and refuses another profile's ids", async () => {
    const { env, db } = openDb();
    const mine = await collection(db, "Mine");
    const theirs = await collection(db, "Theirs", OTHER_PROFILE);
    const myGallery = await gallery(db, "Here", [image("h.png")]);
    const workGallery = await gallery(db, "There", [image("t.png")], OTHER_PROFILE);
    expect((await listed(env)).map((row) => row.id)).toEqual([mine]);
    expect((await listed(env, OTHER_PROFILE)).map((row) => row.id)).toEqual([theirs]);

    expect(await updateCollection(db, USER, PROFILE, theirs, { name: "Hijack" })).toEqual({ error: "missing" });
    expect(await deleteCollection(db, USER, PROFILE, theirs)).toEqual({ error: "missing" });
    expect(await orderCollectionGalleries(db, USER, PROFILE, theirs, [])).toEqual({ error: "missing" });
    expect(await fileGallery(db, USER, PROFILE, myGallery, theirs)).toEqual({ error: "missing" });
    expect(await fileGallery(db, USER, PROFILE, workGallery, mine)).toEqual({ error: "gallery" });
    expect(await fileGallery(db, "someone-else", PROFILE, myGallery, mine)).toEqual({ error: "gallery" });
    expect(await collectionAssets(env, USER, PROFILE, theirs, parseCollectionAssetsQuery(undefined, undefined, undefined, 36))).toEqual({
      error: "missing",
    });
    expect((await listed(env, OTHER_PROFILE))[0]?.name).toBe("Theirs");
  });

  it("refuses a collection past the cap and removes nothing", async () => {
    const { env, db } = openDb();
    for (let n = 0; n < COLLECTION_MAX_PER_PROFILE; n += 1) await collection(db, `C${n}`);
    expect(await createCollection(db, USER, PROFILE, "One more")).toEqual({ error: "limit" });
    const rows = await listed(env);
    expect(rows).toHaveLength(COLLECTION_MAX_PER_PROFILE);
    expect(rows[0]?.name).toBe("C0");
    // The cap is per profile.
    expect("id" in (await createCollection(db, USER, OTHER_PROFILE, "Fine"))).toBe(true);
  });

  it("holds the cap when creates race: only one of several at the last place lands", async () => {
    const { env, db } = openDb();
    for (let n = 0; n < COLLECTION_MAX_PER_PROFILE - 1; n += 1) await collection(db, `C${n}`);
    const results = await Promise.all(
      ["Race 1", "Race 2", "Race 3"].map((name) => createCollection(db, USER, PROFILE, name)),
    );
    expect(results.filter((result) => "id" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result && result.error === "limit")).toHaveLength(2);
    const rows = await listed(env);
    expect(rows).toHaveLength(COLLECTION_MAX_PER_PROFILE);
    // Each new collection still goes at the end.
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, index) => index));
  });

  it("does not file a gallery into a collection that is gone", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    const g1 = await gallery(db, "Day 1", [image("one.png")]);
    await deleteCollection(db, USER, PROFILE, shoot);
    expect(await fileGallery(db, USER, PROFILE, g1, shoot)).toEqual({ error: "missing" });
    expect((await listGalleries(db, USER, "", PROFILE))[0]).toMatchObject({ id: g1, collectionId: null });
    expect(await listed(env)).toEqual([]);
  });

  it("uses the featured image of the first gallery that has one, a chosen cover, and falls back when it goes", async () => {
    const { raw, env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    expect((await listed(env))[0]?.cover).toBeNull();
    const sounds = await gallery(db, "Sounds", [audio("v.mp3")]);
    const day1 = await gallery(db, "Day 1", [image("lead.png"), image("pick.png"), video("clip.mp4")]);
    const day2 = await gallery(db, "Day 2", [image("pick.png"), image("other.png")]);
    for (const id of [sounds, day1, day2]) await fileGallery(db, USER, PROFILE, id, shoot);

    let [row] = await listed(env);
    expect(row?.cover).toMatchObject({ key: `u/${USER}/lead.png`, kind: "image", chosen: false });
    expect(row?.cover?.thumbUrl).toContain("https://studio.test/");
    expect(row?.itemCount).toBe(5);

    expect(await updateCollection(db, USER, PROFILE, shoot, { coverKey: `u/${USER}/other.png` })).toEqual({ id: shoot });
    [row] = await listed(env);
    expect(row?.cover).toMatchObject({ key: `u/${USER}/other.png`, chosen: true });

    // A file outside the collection, or audio, cannot be the cover.
    expect(await updateCollection(db, USER, PROFILE, shoot, { coverKey: `u/${USER}/elsewhere.png` })).toEqual({
      error: "cover",
    });
    expect(await updateCollection(db, USER, PROFILE, shoot, { coverKey: `u/${USER}/v.mp3` })).toEqual({ error: "cover" });
    expect(await updateCollection(db, USER, PROFILE, shoot, { coverKey: "u/other-user/x.png" })).toEqual({ error: "cover" });

    // Its gallery leaves: back to automatic, no error.
    await fileGallery(db, USER, PROFILE, day2, null);
    [row] = await listed(env);
    expect(row?.cover).toMatchObject({ key: `u/${USER}/lead.png`, chosen: false });

    // Chosen again, then the file is deleted: back to automatic.
    await fileGallery(db, USER, PROFILE, day2, shoot);
    await updateCollection(db, USER, PROFILE, shoot, { coverKey: `u/${USER}/clip.mp4` });
    [row] = await listed(env);
    expect(row?.cover).toMatchObject({ key: `u/${USER}/clip.mp4`, kind: "video", chosen: true });
    await deleteGalleryFiles(env, USER, [`u/${USER}/clip.mp4`]);
    [row] = await listed(env);
    expect(row?.cover).toMatchObject({ key: `u/${USER}/lead.png`, chosen: false });

    // Reset goes back to automatic and clears the stored key.
    await updateCollection(db, USER, PROFILE, shoot, { coverKey: `u/${USER}/other.png` });
    await updateCollection(db, USER, PROFILE, shoot, { coverKey: null });
    expect(raw.prepare(`SELECT cover_key FROM collections WHERE id = ?`).get(shoot)).toEqual({ cover_key: null });
    expect((await listed(env))[0]?.cover?.chosen).toBe(false);
  });

  it("drops a deleted gallery from its collection", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    const g1 = await gallery(db, "One", [image("1.png")]);
    await fileGallery(db, USER, PROFILE, g1, shoot);
    await deleteGallery(db, USER, g1);
    expect((await listed(env))[0]).toMatchObject({ galleryIds: [], itemCount: 0, cover: null });
  });

  it("keeps slots that point at a gallery working after it is filed, moved, or ungrouped", async () => {
    const { env, db } = openDb();
    const g1 = await gallery(db, "Maya", [image("face.png")]);
    const slot = await createSlot(env, USER, PROFILE, { name: "Lead", galleryId: g1 });
    const a = await collection(db, "A");
    const b = await collection(db, "B");
    for (const target of [a, b, null]) {
      await fileGallery(db, USER, PROFILE, g1, target);
      const found = (await listSlots(env, USER, PROFILE)).find((row) => row.id === slot?.id);
      expect(found).toMatchObject({ galleryId: g1, galleryName: "Maya" });
      expect(found?.files.map((file) => file.name)).toEqual(["face.png"]);
    }
  });
});

describe("collection assets", () => {
  it("lists every file once, in gallery order then item order, and pages and filters it", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    const day1 = await gallery(db, "Day 1", [image("a.png", "background", "Room"), video("b.mp4"), audio("c.mp3")]);
    const day2 = await gallery(db, "Day 2", [image("d.png"), image("a.png")]);
    await gallery(db, "Elsewhere", [image("x.png")]);
    await fileGallery(db, USER, PROFILE, day2, shoot);
    await fileGallery(db, USER, PROFILE, day1, shoot);
    await orderCollectionGalleries(db, USER, PROFILE, shoot, [day1, day2]);

    const all = await collectionAssets(env, USER, PROFILE, shoot, parseCollectionAssetsQuery(undefined, "1", "12", 36));
    if ("error" in all) throw new Error(all.error);
    expect(all.total).toBe(4);
    expect(all.pageSize).toBe(12);
    expect(all.assets.map((asset) => [asset.name, asset.galleryName, asset.galleryCount])).toEqual([
      ["a.png", "Day 1", 2],
      ["b.mp4", "Day 1", 1],
      ["c.mp3", "Day 1", 1],
      ["d.png", "Day 2", 1],
    ]);
    expect(all.assets[0]).toMatchObject({ role: "background", label: "Room", galleryId: day1, kind: "image" });
    expect(all.assets[2]).toMatchObject({ role: null, kind: "audio" });
    expect(all.assets[0]?.url).toContain("https://studio.test/");

    const images = await collectionAssets(env, USER, PROFILE, shoot, parseCollectionAssetsQuery("image", "1", undefined, 36));
    if ("error" in images) throw new Error(images.error);
    expect(images.media).toBe("image");
    expect(images.assets.map((asset) => asset.name)).toEqual(["a.png", "d.png"]);

    const audioOnly = await collectionAssets(env, USER, PROFILE, shoot, parseCollectionAssetsQuery("audio", "1", undefined, 36));
    if ("error" in audioOnly) throw new Error(audioOnly.error);
    expect(audioOnly.assets.map((asset) => asset.name)).toEqual(["c.mp3"]);
  });

  it("pages at the user's page size and signs only that page", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    const names = Array.from({ length: 30 }, (_, n) => `f${String(n).padStart(2, "0")}.png`);
    const g1 = await gallery(db, "Big", names.map((name) => image(name)));
    await fileGallery(db, USER, PROFILE, g1, shoot);
    const second = await collectionAssets(env, USER, PROFILE, shoot, parseCollectionAssetsQuery(undefined, "2", undefined, 12));
    if ("error" in second) throw new Error(second.error);
    expect(second.total).toBe(30);
    expect(second.assets.map((asset) => asset.name)).toEqual(names.slice(12, 24));
    const past = await collectionAssets(env, USER, PROFILE, shoot, parseCollectionAssetsQuery(undefined, "9", undefined, 12));
    expect(past).toMatchObject({ assets: [], total: 30, page: 9 });
  });

  it("reads the query safely", () => {
    expect(parseCollectionAssetsQuery("bogus", "-3", "7", 24)).toEqual({ media: "", page: 1, pageSize: 36 });
    expect(parseCollectionAssetsQuery("video", "2.9", undefined, 24)).toEqual({ media: "video", page: 2, pageSize: 24 });
  });
});

describe("collections before the migration", () => {
  it("answers not ready and refuses writes plainly while galleries work as today", async () => {
    const { env, db } = openDb({ withoutCollections: true });
    expect(await listCollections(env, USER, PROFILE)).toEqual({ collections: [], ready: false });
    const id = await gallery(db, "Maya", [image("a.png")]);
    const [summary] = await listGalleries(db, USER, "", PROFILE);
    expect(summary).toMatchObject({ id, name: "Maya", collectionId: null });
    const cards = await presentGalleryList(env, USER, "");
    expect(cards[0]).toMatchObject({ id, collectionId: null, count: 1 });
    expect(await createCollection(db, USER, PROFILE, "Shoot")).toEqual({ error: "unavailable" });
    expect(await updateCollection(db, USER, PROFILE, "c1", { name: "x" })).toEqual({ error: "unavailable" });
    expect(await deleteCollection(db, USER, PROFILE, "c1")).toEqual({ error: "unavailable" });
    expect(await orderCollections(db, USER, PROFILE, [])).toEqual({ error: "unavailable" });
    expect(await orderCollectionGalleries(db, USER, PROFILE, "c1", [])).toEqual({ error: "unavailable" });
    expect(await fileGallery(db, USER, PROFILE, id, null)).toEqual({ error: "unavailable" });
    expect(
      await collectionAssets(env, USER, PROFILE, "c1", parseCollectionAssetsQuery(undefined, undefined, undefined, 36)),
    ).toEqual({ error: "unavailable" });
    expect(await deleteAllUserMedia(env, USER)).toMatchObject({ deleted: 0 });
  });
});

describe("collections cleanup", () => {
  it("Settings then Cleanup removes the user's collections with their galleries", async () => {
    const { raw, env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    await collection(db, "Work", OTHER_PROFILE);
    const g1 = await gallery(db, "One", [image("1.png")]);
    await fileGallery(db, USER, PROFILE, g1, shoot);
    raw
      .prepare(
        `INSERT INTO collections (id, user_id, profile_id, name, position, created_at, updated_at)
         VALUES ('keep', 'someone-else', NULL, 'Theirs', 0, 1, 1)`,
      )
      .run();
    await deleteAllUserMedia(env, USER);
    expect(raw.prepare(`SELECT id FROM collections WHERE user_id = ?`).all(USER)).toEqual([]);
    expect(raw.prepare(`SELECT id FROM galleries WHERE user_id = ?`).all(USER)).toEqual([]);
    expect(raw.prepare(`SELECT id FROM collections`).all()).toEqual([{ id: "keep" }]);
  });
});

describe("collection routes", () => {
  const origin = "https://studio.test";
  const cookie = `${SESSION_COOKIE}=${TEST_SESSION_ID}`;

  function call(env: Env, path: string, init: { method?: string; body?: unknown } = {}) {
    return app.request(
      `${origin}${path}`,
      {
        method: init.method ?? "GET",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      env,
    );
  }

  it("needs a signed-in user", async () => {
    const { env } = openDb();
    const res = await app.request(`${origin}/api/collections`, {}, env);
    expect(res.status).toBe(401);
  });

  it("creates, files, orders, pages, covers, and deletes through the API", async () => {
    const { env, db } = openDb();
    const created = await call(env, "/api/collections", { method: "POST", body: { name: "Shoot" } });
    expect(created.status).toBe(200);
    const { collection: made } = (await created.json()) as { collection: { id: string; galleryIds: string[] } };
    expect(made.galleryIds).toEqual([]);

    // A gallery made inside an open collection is filed there.
    const g1Res = await call(env, "/api/galleries", {
      method: "POST",
      body: { name: "Day 1", items: [image("a.png")], collectionId: made.id },
    });
    expect(g1Res.status).toBe(200);
    const g1 = ((await g1Res.json()) as { gallery: { id: string } }).gallery.id;
    const g2 = await gallery(db, "Day 2", [image("b.png")]);

    const filed = await call(env, `/api/galleries/${g2}/collection`, { method: "PUT", body: { collectionId: made.id } });
    expect(await filed.json()).toEqual({ ok: true, galleryId: g2, collectionId: made.id });
    expect((await call(env, `/api/galleries/${g2}/collection`, { method: "PUT", body: {} })).status).toBe(400);

    const cards = (await (await call(env, "/api/galleries")).json()) as { galleries: { id: string; collectionId: string | null }[] };
    expect(cards.galleries.map((card) => [card.id, card.collectionId]).sort()).toEqual(
      [
        [g1, made.id],
        [g2, made.id],
      ].sort(),
    );

    const ordered = await call(env, `/api/collections/${made.id}/order`, { method: "PUT", body: { galleryIds: [g2, g1] } });
    expect(await ordered.json()).toEqual({ galleryIds: [g2, g1] });

    const assets = (await (await call(env, `/api/collections/${made.id}/assets?media=image&page=1`)).json()) as {
      assets: { name: string }[];
      pageSize: number;
    };
    expect(assets.assets.map((asset) => asset.name)).toEqual(["b.png", "a.png"]);
    // No pageSize in the query: the user's Settings then Library page size.
    expect(assets.pageSize).toBe(12);

    const covered = await call(env, `/api/collections/${made.id}`, {
      method: "PATCH",
      body: { coverKey: `u/${USER}/a.png`, name: "Shoot 1" },
    });
    expect(((await covered.json()) as { collection: unknown }).collection).toMatchObject({
      name: "Shoot 1",
      cover: { key: `u/${USER}/a.png`, chosen: true },
    });

    const order = await call(env, "/api/collections/order", { method: "PUT", body: { ids: [made.id] } });
    expect(await order.json()).toEqual({ ids: [made.id] });

    const listedRes = (await (await call(env, "/api/collections")).json()) as { ready: boolean; collections: unknown[] };
    expect(listedRes.ready).toBe(true);
    expect(listedRes.collections).toHaveLength(1);

    const removed = await call(env, `/api/collections/${made.id}`, { method: "DELETE" });
    expect(await removed.json()).toEqual({ ok: true, ungrouped: 2 });
    expect((await call(env, `/api/collections/${made.id}`, { method: "DELETE" })).status).toBe(404);
    expect(await getGallery(db, USER, g1)).toBeTruthy();
  });

  it("refuses an unknown collection on gallery create and answers the cap plainly", async () => {
    const { env, db } = openDb();
    const res = await call(env, "/api/galleries", {
      method: "POST",
      body: { name: "Day 1", items: [], collectionId: "missing" },
    });
    expect(res.status).toBe(404);
    expect((await listGalleries(db, USER, "", PROFILE)).length).toBe(0);
    for (let n = 0; n < COLLECTION_MAX_PER_PROFILE; n += 1) await collection(db, `C${n}`);
    const full = await call(env, "/api/collections", { method: "POST", body: { name: "One more" } });
    expect(full.status).toBe(400);
    expect(((await full.json()) as { error: string }).error).toMatch(/50 collections/);
  });

  it("fails a create whole when its collection goes before the gallery is filed", async () => {
    const { env, db } = openDb();
    const shoot = await collection(db, "Shoot");
    // The collection is deleted by another request between the check and the filing.
    const racing = {
      ...db,
      prepare(sql: string) {
        if (sql.startsWith("UPDATE galleries SET collection_id = ?,")) {
          return {
            bind: (...args: unknown[]) => ({
              run: async () => {
                await deleteCollection(db, USER, PROFILE, shoot);
                return db.prepare(sql).bind(...args).run();
              },
            }),
          };
        }
        return db.prepare(sql);
      },
    } as unknown as D1Database;
    const res = await call({ ...env, DB: racing } as Env, "/api/galleries", {
      method: "POST",
      body: { name: "Day 1", items: [image("a.png")], collectionId: shoot },
    });
    expect(res.status).toBe(404);
    expect(await listGalleries(db, USER, "", PROFILE)).toEqual([]);
  });

  it("serves the Galleries screen and an empty, not-ready list before the migration", async () => {
    const { env, db } = openDb({ withoutCollections: true });
    await gallery(db, "Maya", [image("a.png")]);
    expect(await (await call(env, "/api/collections")).json()).toEqual({ collections: [], ready: false });
    const cards = await call(env, "/api/galleries");
    expect(cards.status).toBe(200);
    const created = await call(env, "/api/galleries", {
      method: "POST",
      body: { name: "Day 1", items: [image("b.png")], collectionId: "anything" },
    });
    expect(created.status).toBe(200);
    const write = await call(env, "/api/collections", { method: "POST", body: { name: "Shoot" } });
    expect(write.status).toBe(400);
    expect(((await write.json()) as { error: string }).error).toBe("Collections are not available yet");
  });
});
