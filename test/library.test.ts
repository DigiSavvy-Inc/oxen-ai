import { afterEach, describe, expect, it } from "vitest";
import {
  BULK_DELETE_MAX_IDS,
  UNFINISHED_GENERATION_SQL,
  deleteAllUserMedia,
  findOwnedGenerations,
  parseBulkDeleteIds,
  parseCleanupAction,
  parseFromOxenFlag,
  removeStudioGeneration,
  removeStudioGenerations,
  thumbIsReusable,
  type LibraryAssetRow,
} from "../worker/library";
import {
  createImageThumbnail,
  encodeImageForOxen,
  isRasterImage,
  pngForProviderFetch,
  providerFetchAcceptsImage,
  THUMB_MAX_BYTES,
} from "../worker/thumbs";
import { createEnv, createMockR2, TEST_USER } from "./helpers";
import { createFakeHub, fakeRepo, workspaceUrl } from "./oxen-hub-fake";
import type { Env } from "../worker/types";

const REPO = "digisavvy/playground";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function libraryDb(rows: LibraryAssetRow[]) {
  const generations = [...rows];
  const statements: string[] = [];
  return {
    generations,
    statements,
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                if (sql.includes("FROM generations WHERE user_id = ? AND id IN")) {
                  const ids = new Set(args.slice(1));
                  return {
                    results:
                      args[0] === TEST_USER.id ? generations.filter((row) => ids.has(row.id)) : [],
                  };
                }
                if (sql.includes("FROM generations WHERE user_id")) {
                  return {
                    results: args[0] === TEST_USER.id ? [...generations] : [],
                  };
                }
                return { results: [] };
              },
              async run() {
                statements.push(sql);
                if (sql.includes("DELETE FROM generations WHERE user_id = ? AND id IN")) {
                  if (args[0] === TEST_USER.id) {
                    const ids = new Set(args.slice(1));
                    for (let i = generations.length - 1; i >= 0; i--) {
                      if (ids.has(generations[i]!.id)) generations.splice(i, 1);
                    }
                  }
                } else if (sql.includes("DELETE FROM generations WHERE user_id")) {
                  if (args[0] === TEST_USER.id) generations.splice(0, generations.length);
                }
                if (sql.includes("DELETE FROM generations WHERE id")) {
                  const index = generations.findIndex(
                    (row) => row.id === args[0] && args[1] === TEST_USER.id,
                  );
                  if (index >= 0) generations.splice(index, 1);
                }
                return { success: true };
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
    } as unknown as Env["DB"],
  };
}

describe("library cleanup", () => {
  it("accepts failed, thumbs, and all actions", () => {
    expect(parseCleanupAction("failed")).toBe("failed");
    expect(parseCleanupAction("thumbs")).toBe("thumbs");
    expect(parseCleanupAction("all")).toBe("all");
    expect(parseCleanupAction("wipe")).toBeNull();
    expect(UNFINISHED_GENERATION_SQL).toContain("status IN ('failed', 'cancelled')");
    expect(UNFINISHED_GENERATION_SQL).toContain("COALESCE(result_url, '') = ''");
    expect(UNFINISHED_GENERATION_SQL).toContain("COALESCE(result_key, '') = ''");
  });

  it("parses the Oxen-delete flag", () => {
    expect(parseFromOxenFlag("1")).toBe(true);
    expect(parseFromOxenFlag(true)).toBe(true);
    expect(parseFromOxenFlag("false")).toBe(false);
    expect(parseFromOxenFlag(undefined)).toBe(false);
  });

  it("nukes this user's D1 rows and R2 prefix", async () => {
    const { store, bucket } = createMockR2();
    await bucket.put("u/user-1/results/a.png", "result");
    await bucket.put("u/user-1/uploads/drop.png", "upload");
    await bucket.put("u/other/results/keep.png", "keep");
    const db = libraryDb([
      {
        id: "gen-1",
        status: "succeeded",
        result_key: "u/user-1/results/a.png",
        result_url: "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/ws/files/a.png",
      },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const result = await deleteAllUserMedia(env, TEST_USER.id, { fromOxen: false });
    expect(result.deleted).toBe(1);
    expect(result.r2Deleted).toBe(2);
    expect(store.has("u/user-1/results/a.png")).toBe(false);
    expect(store.has("u/other/results/keep.png")).toBe(true);
    expect(db.generations).toHaveLength(0);
    expect(db.statements.some((sql) => sql.includes("DELETE FROM slot_files"))).toBe(true);
    expect(db.statements.some((sql) => sql.includes("DELETE FROM slots"))).toBe(true);
  });

  it("removes one item's Oxen copy and reports what Oxen did", async () => {
    const hub = createFakeHub({
      [REPO]: fakeRepo({ branches: { main: ["a.png"] }, workspaces: { ws: { base: ["a.png"] } } }),
    });
    globalThis.fetch = hub.fetch;
    const { store, bucket } = createMockR2();
    await bucket.put("u/user-1/results/a.png", "result");
    await bucket.put("u/user-1/thumbs/a.webp", "thumb");
    const db = libraryDb([
      {
        id: "gen-1",
        status: "succeeded",
        oxen_generation_id: "oxen-1",
        result_key: "u/user-1/results/a.png",
        thumb_key: "u/user-1/thumbs/a.webp",
        result_url: workspaceUrl("a.png"),
      },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const result = await removeStudioGeneration(env, TEST_USER.id, db.generations[0]!, {
      apiKey: "test-key",
      fromOxen: true,
    });

    expect(result).toEqual({ oxenDeleted: 1, oxenAlreadyGone: 0, oxenFailed: 0 });
    expect(hub.repos.get(REPO)!.branches.get("main")!.size).toBe(0);
    // A finished job is not sent to the queue's cancel call.
    expect(hub.cancelled).toEqual([]);
    expect(db.generations).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("leaves Oxen alone when only the Studio copy is deleted, and cancels a running job", async () => {
    const hub = createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) });
    globalThis.fetch = hub.fetch;
    const db = libraryDb([
      { id: "gen-1", status: "succeeded", oxen_generation_id: "oxen-1", result_url: workspaceUrl("a.png") },
      { id: "gen-2", status: "processing", oxen_generation_id: "oxen-2" },
    ]);
    const env = createEnv({ DB: db.db });
    const result = await removeStudioGenerations(env, TEST_USER.id, [...db.generations], {
      apiKey: "test-key",
      fromOxen: false,
    });

    expect(result).toEqual({ oxenDeleted: 0, oxenAlreadyGone: 0, oxenFailed: 0 });
    expect(hub.cancelled).toEqual(["oxen-2"]);
    expect(hub.calls).toHaveLength(1);
    expect(hub.repos.get(REPO)!.branches.get("main")!.has("a.png")).toBe(true);
    expect(db.generations).toHaveLength(0);
  });

  it("deletes the Studio item when its Oxen copy is already gone", async () => {
    // The repository was deleted on Oxen and not recreated yet.
    globalThis.fetch = createFakeHub({}).fetch;
    const db = libraryDb([
      { id: "gen-1", status: "succeeded", result_url: workspaceUrl("old.png", "old-ws") },
    ]);
    const env = createEnv({ DB: db.db });
    const result = await removeStudioGeneration(env, TEST_USER.id, db.generations[0]!, {
      apiKey: "test-key",
      fromOxen: true,
    });

    expect(result).toEqual({ oxenDeleted: 0, oxenAlreadyGone: 1, oxenFailed: 0 });
    expect(db.generations).toHaveLength(0);
  });

  it("still deletes the Studio item when Oxen fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const { store, bucket } = createMockR2();
    await bucket.put("u/user-1/results/a.png", "result");
    const db = libraryDb([
      {
        id: "gen-1",
        status: "succeeded",
        result_key: "u/user-1/results/a.png",
        result_url: workspaceUrl("a.png"),
      },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const result = await removeStudioGeneration(env, TEST_USER.id, db.generations[0]!, {
      apiKey: "test-key",
      fromOxen: true,
    });

    expect(result).toEqual({ oxenDeleted: 0, oxenAlreadyGone: 0, oxenFailed: 1 });
    expect(db.generations).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("reports the Oxen copies as not removed when there is no saved key", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    const db = libraryDb([
      { id: "gen-1", status: "succeeded", result_url: workspaceUrl("a.png") },
      { id: "gen-2", status: "failed" },
    ]);
    const env = createEnv({ DB: db.db });
    const result = await removeStudioGenerations(env, TEST_USER.id, [...db.generations], {
      apiKey: null,
      fromOxen: true,
    });

    expect(result).toEqual({ oxenDeleted: 0, oxenAlreadyGone: 0, oxenFailed: 1 });
    expect(called).toBe(false);
    expect(db.generations).toHaveLength(0);
  });

  it("removes a selection with one Oxen commit and reports each outcome", async () => {
    const hub = createFakeHub(
      {
        [REPO]: fakeRepo({
          branches: { main: ["a.png", "b.png", "stuck.png"] },
          workspaces: { ws: { base: ["a.png", "b.png", "stuck.png"], added: ["staged.mp4"] } },
        }),
        "digisavvy/broken": fakeRepo({ branches: { main: ["x.png"] } }),
      },
      (call) =>
        call.method === "POST" && call.path.startsWith("/api/repos/digisavvy/broken/")
          ? new Response("{}", { status: 422 })
          : undefined,
    );
    globalThis.fetch = hub.fetch;
    const { store, bucket } = createMockR2();
    await bucket.put("u/user-1/results/a.png", "result");
    await bucket.put("u/user-1/results/keep.png", "keep");
    const db = libraryDb([
      { id: "gen-1", status: "succeeded", result_key: "u/user-1/results/a.png", result_url: workspaceUrl("a.png") },
      { id: "gen-2", status: "succeeded", result_url: workspaceUrl("b.png") },
      { id: "gen-3", status: "succeeded", result_url: workspaceUrl("staged.mp4") },
      { id: "gen-4", status: "succeeded", result_url: workspaceUrl("old.png", "old-ws") },
      { id: "gen-5", status: "succeeded", result_url: workspaceUrl("x.png", "ws", "digisavvy/broken") },
      { id: "gen-6", status: "failed" },
      { id: "keep", status: "succeeded", result_url: workspaceUrl("stuck.png") },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const ids = ["gen-1", "gen-2", "gen-3", "gen-4", "gen-5", "gen-6", "not-mine"];
    const rows = await findOwnedGenerations(env, TEST_USER.id, ids);
    expect(rows.map((row) => row.id)).toEqual(ids.slice(0, 6));
    const result = await removeStudioGenerations(env, TEST_USER.id, rows, {
      apiKey: "test-key",
      fromOxen: true,
    });

    expect(result).toEqual({ oxenDeleted: 3, oxenAlreadyGone: 1, oxenFailed: 1 });
    expect(hub.commits).toHaveLength(1);
    expect(hub.commits[0]!.removed).toEqual(["a.png", "b.png"]);
    expect([...hub.repos.get(REPO)!.branches.get("main")!]).toEqual(["stuck.png"]);
    expect([...hub.repos.get("digisavvy/broken")!.branches.get("main")!]).toEqual(["x.png"]);
    expect(db.generations.map((row) => row.id)).toEqual(["keep"]);
    expect([...store.keys()]).toEqual(["u/user-1/results/keep.png"]);
    // One statement pair for the whole selection, not one per row.
    expect(db.statements.filter((sql) => sql.includes("DELETE FROM generations"))).toHaveLength(1);
  });

  it("removes every Oxen copy in one pass when the library is wiped", async () => {
    const hub = createFakeHub({
      [REPO]: fakeRepo({
        branches: { main: ["a.png", "b.png"] },
        workspaces: { ws: { base: ["a.png", "b.png"] } },
      }),
    });
    globalThis.fetch = hub.fetch;
    const { bucket } = createMockR2();
    await bucket.put("u/user-1/results/a.png", "result");
    const db = libraryDb([
      { id: "gen-1", status: "succeeded", result_key: "u/user-1/results/a.png", result_url: workspaceUrl("a.png") },
      { id: "gen-2", status: "succeeded", result_url: workspaceUrl("b.png") },
      { id: "gen-3", status: "succeeded", result_url: workspaceUrl("old.png", "old-ws") },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const result = await deleteAllUserMedia(env, TEST_USER.id, {
      apiKey: "test-key",
      fromOxen: true,
    });

    expect(result).toEqual({
      deleted: 3,
      r2Deleted: 1,
      oxenDeleted: 2,
      oxenAlreadyGone: 1,
      oxenFailed: 0,
    });
    expect(hub.commits).toHaveLength(1);
    expect(db.generations).toHaveLength(0);
  });

  it("accepts a bounded list of ids for a bulk delete", () => {
    expect(parseBulkDeleteIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(parseBulkDeleteIds([])).toBeNull();
    expect(parseBulkDeleteIds("a")).toBeNull();
    expect(parseBulkDeleteIds(["a", 2])).toBeNull();
    expect(parseBulkDeleteIds(Array.from({ length: BULK_DELETE_MAX_IDS }, (_, i) => `id-${i}`))).toHaveLength(
      BULK_DELETE_MAX_IDS,
    );
    expect(
      parseBulkDeleteIds(Array.from({ length: BULK_DELETE_MAX_IDS + 1 }, (_, i) => `id-${i}`)),
    ).toBeNull();
  });
});

describe("thumbnails", () => {
  it("only resizes raster images when an Images binding exists", async () => {
    expect(isRasterImage("image/png")).toBe(true);
    expect(isRasterImage("video/mp4")).toBe(false);
    expect(await createImageThumbnail(undefined, new ArrayBuffer(8), "image/png")).toBeNull();
    const raw = new Uint8Array([1, 2, 3, 4]).buffer;
    await expect(encodeImageForOxen(undefined, raw, "image/png")).resolves.toEqual({
      bytes: raw,
      contentType: "image/png",
    });
    expect(providerFetchAcceptsImage("image/avif")).toBe(false);
    expect(providerFetchAcceptsImage("image/jpeg")).toBe(true);
    await expect(pngForProviderFetch(undefined, raw, "image/png")).resolves.toEqual({
      bytes: raw,
      contentType: "image/png",
    });
    await expect(pngForProviderFetch(undefined, raw, "image/avif")).resolves.toBeNull();
  });

  it("skips R2 HEADs for thumbs that already exist unless rebuilding oversized files", () => {
    expect(thumbIsReusable({ size: 400_000 }, false)).toBe(true);
    expect(thumbIsReusable({ size: 400_000 }, true)).toBe(false);
    expect(thumbIsReusable({ size: THUMB_MAX_BYTES }, true)).toBe(true);
    expect(thumbIsReusable(null, false)).toBe(false);
  });
});
