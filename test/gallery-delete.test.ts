import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { parseGalleryFileKeys } from "../worker/gallery-delete";
import { GALLERY_MAX_ITEMS } from "../worker/gallery-limits";
import { createEnv, createMockDb, createMockR2, TEST_SECRET, TEST_SESSION_ID, TEST_USER } from "./helpers";
import { createFakeHub, fakeRepo, workspaceUrl } from "./oxen-hub-fake";
import type { UserRow } from "../worker/types";

const originalFetch = globalThis.fetch;
const REPO = "digisavvy/playground";
const ORIGIN = "https://studio.digisavvy.dev";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type GenerationRow = {
  id: string;
  user_id: string;
  status: string;
  result_key: string | null;
  thumb_key: string | null;
  result_url: string | null;
};
type ItemRow = { gallery_id: string; user_id: string; media_key: string };
type GalleryRow = { id: string; user_id: string; updated_at: number };
type Tables = { generations: GenerationRow[]; items: ItemRow[]; galleries: GalleryRow[] };

async function userWithOxenKey(): Promise<UserRow> {
  const { ciphertext, iv } = await encryptSecret("test-key", TEST_SECRET);
  return { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
}

function drop<T>(rows: T[], gone: (row: T) => boolean) {
  for (let at = rows.length - 1; at >= 0; at -= 1) {
    if (gone(rows[at]!)) rows.splice(at, 1);
  }
}

/** The session lookups of the shared mock, plus generations, galleries, and gallery items. */
function dbWith(user: UserRow, tables: Tables): D1Database {
  const base = createMockDb(user, TEST_SESSION_ID);
  return {
    prepare(sql: string) {
      const fallback = base.prepare(sql);
      return {
        bind(...args: unknown[]) {
          const bound = fallback.bind(...args);
          const rest = new Set(args.slice(1));
          return {
            first: () => bound.first(),
            async all() {
              if (sql.includes("FROM generations WHERE user_id = ? AND result_key IN")) {
                return {
                  results: tables.generations.filter(
                    (row) => row.user_id === args[0] && rest.has(row.result_key),
                  ),
                };
              }
              if (sql.includes("SELECT DISTINCT gallery_id FROM gallery_items")) {
                const ids = new Set(
                  tables.items
                    .filter((row) => row.user_id === args[0] && rest.has(row.media_key))
                    .map((row) => row.gallery_id),
                );
                return { results: [...ids].map((gallery_id) => ({ gallery_id })) };
              }
              return bound.all();
            },
            async run() {
              if (sql.includes("DELETE FROM generations WHERE user_id = ? AND id IN")) {
                drop(tables.generations, (row) => row.user_id === args[0] && rest.has(row.id));
              }
              if (sql.includes("DELETE FROM gallery_items WHERE user_id = ? AND media_key IN")) {
                drop(tables.items, (row) => row.user_id === args[0] && rest.has(row.media_key));
              }
              if (sql.includes("UPDATE galleries SET updated_at = ?")) {
                const ids = new Set(args.slice(2));
                for (const row of tables.galleries) {
                  if (row.user_id === args[1] && ids.has(row.id)) row.updated_at = Number(args[0]);
                }
              }
              return bound.run();
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function request(body: unknown, env: ReturnType<typeof createEnv>) {
  return app.request(
    `${ORIGIN}/api/galleries/files/delete`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
        "Content-Type": "application/json",
      },
    },
    env,
  );
}

const MADE = "u/user-1/results/made.png";
const MADE_THUMB = "u/user-1/thumbs/made.webp";
const DROPPED = "u/user-1/uploads/dropped.png";
const KEPT = "u/user-1/results/kept.png";
const THEIRS = "u/user-2/results/theirs.png";

async function scene(resultUrl: string | null = workspaceUrl("made.png")) {
  const user = await userWithOxenKey();
  const tables: Tables = {
    generations: [
      { id: "gen-made", user_id: user.id, status: "succeeded", result_key: MADE, thumb_key: MADE_THUMB, result_url: resultUrl },
      { id: "gen-kept", user_id: user.id, status: "succeeded", result_key: KEPT, thumb_key: null, result_url: workspaceUrl("kept.png") },
      { id: "gen-theirs", user_id: "user-2", status: "succeeded", result_key: THEIRS, thumb_key: null, result_url: workspaceUrl("theirs.png") },
    ],
    items: [
      { gallery_id: "open", user_id: user.id, media_key: MADE },
      { gallery_id: "open", user_id: user.id, media_key: DROPPED },
      { gallery_id: "open", user_id: user.id, media_key: KEPT },
      { gallery_id: "other", user_id: user.id, media_key: MADE },
      { gallery_id: "untouched", user_id: user.id, media_key: KEPT },
      { gallery_id: "theirs", user_id: "user-2", media_key: THEIRS },
    ],
    galleries: [
      { id: "open", user_id: user.id, updated_at: 100 },
      { id: "other", user_id: user.id, updated_at: 100 },
      { id: "untouched", user_id: user.id, updated_at: 100 },
      { id: "theirs", user_id: "user-2", updated_at: 100 },
    ],
  };
  const { store, bucket } = createMockR2();
  for (const key of [MADE, MADE_THUMB, DROPPED, KEPT, THEIRS]) await bucket.put(key, "bytes");
  const env = createEnv({ DB: dbWith(user, tables), MEDIA: bucket });
  return { tables, store, env };
}

describe("gallery file keys", () => {
  it("takes one gallery's worth of the caller's own keys, without repeats", () => {
    expect(parseGalleryFileKeys("user-1", [MADE, DROPPED, MADE])).toEqual([MADE, DROPPED]);
    const full = Array.from({ length: GALLERY_MAX_ITEMS }, (_, at) => `u/user-1/uploads/${at}.png`);
    expect(parseGalleryFileKeys("user-1", full)).toHaveLength(GALLERY_MAX_ITEMS);
  });

  it("rejects a missing or empty list, too many keys, and any key that is not the caller's", () => {
    const tooMany = Array.from({ length: GALLERY_MAX_ITEMS + 1 }, (_, at) => `u/user-1/uploads/${at}.png`);
    for (const raw of [undefined, MADE, [], tooMany, [MADE, THEIRS], [MADE, 7], ["u/user-1/../user-2/x.png"]]) {
      expect(parseGalleryFileKeys("user-1", raw)).toBeNull();
    }
  });
});

describe("POST /api/galleries/files/delete", () => {
  it("requires a session", async () => {
    const res = await app.request(
      `${ORIGIN}/api/galleries/files/delete`,
      { method: "POST", body: JSON.stringify({ keys: [MADE] }) },
      createEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("refuses another user's file and deletes nothing", async () => {
    const { tables, store, env } = await scene();
    const res = await request({ keys: [MADE, THEIRS] }, env);
    expect(res.status).toBe(400);
    expect(store.has(MADE)).toBe(true);
    expect(store.has(THEIRS)).toBe(true);
    expect(tables.generations).toHaveLength(3);
    expect(tables.items).toHaveLength(6);
  });

  it("removes the files from Studio and from every gallery, and leaves Oxen alone unless asked", async () => {
    const hub = createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["made.png", "kept.png"] } }) });
    globalThis.fetch = hub.fetch;
    const { tables, store, env } = await scene();
    const res = await request({ keys: [MADE, DROPPED] }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 2,
      oxenDeleted: 0,
      oxenAlreadyGone: 0,
      oxenFailed: 0,
    });
    expect(hub.calls).toHaveLength(0);
    // The generated file, its thumbnail, and the dropped file are gone. Everything else stays.
    expect([...store.keys()].sort()).toEqual([KEPT, THEIRS].sort());
    expect(tables.generations.map((row) => row.id)).toEqual(["gen-kept", "gen-theirs"]);
    expect(tables.items).toEqual([
      { gallery_id: "open", user_id: "user-1", media_key: KEPT },
      { gallery_id: "untouched", user_id: "user-1", media_key: KEPT },
      { gallery_id: "theirs", user_id: "user-2", media_key: THEIRS },
    ]);
    // Galleries that lost a file read as changed, so an open tab reloads them.
    const stamp = Object.fromEntries(tables.galleries.map((row) => [row.id, row.updated_at > 100]));
    expect(stamp).toEqual({ open: true, other: true, untouched: false, theirs: false });
  });

  it("deletes the Oxen copy of a generated file when asked, and reports a dropped file as having none", async () => {
    const hub = createFakeHub({
      [REPO]: fakeRepo({
        branches: { main: ["made.png", "kept.png"] },
        workspaces: { ws: { base: ["made.png", "kept.png"] } },
      }),
    });
    globalThis.fetch = hub.fetch;
    const { tables, store, env } = await scene();
    const res = await request({ keys: [MADE, DROPPED], fromOxen: true }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 2,
      oxenDeleted: 1,
      oxenAlreadyGone: 0,
      oxenFailed: 0,
    });
    expect(hub.commits).toHaveLength(1);
    expect([...hub.repos.get(REPO)!.branches.get("main")!]).toEqual(["kept.png"]);
    expect(store.has(MADE)).toBe(false);
    expect(store.has(DROPPED)).toBe(false);
    expect(tables.generations.map((row) => row.id)).toEqual(["gen-kept", "gen-theirs"]);
  });

  it("still removes the Studio files when Oxen could not remove its copy, and says so", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    const { tables, store, env } = await scene();
    const res = await request({ keys: [MADE], fromOxen: true }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 1,
      oxenDeleted: 0,
      oxenAlreadyGone: 0,
      oxenFailed: 1,
    });
    expect(store.has(MADE)).toBe(false);
    expect(tables.items.some((row) => row.media_key === MADE)).toBe(false);
  });
});
