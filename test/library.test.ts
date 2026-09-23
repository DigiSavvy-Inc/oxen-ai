import { afterEach, describe, expect, it } from "vitest";
import {
  deleteAllUserMedia,
  parseCleanupAction,
  parseFromOxenFlag,
  removeStudioGeneration,
  thumbIsReusable,
  type LibraryAssetRow,
} from "../worker/library";
import {
  createImageThumbnail,
  encodeImageForOxen,
  isRasterImage,
  THUMB_MAX_BYTES,
} from "../worker/thumbs";
import { createEnv, createMockR2, TEST_USER } from "./helpers";
import type { Env } from "../worker/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function libraryDb(rows: LibraryAssetRow[]) {
  const generations = [...rows];
  return {
    generations,
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                if (sql.includes("FROM generations WHERE user_id")) {
                  return {
                    results: args[0] === TEST_USER.id ? [...generations] : [],
                  };
                }
                return { results: [] };
              },
              async run() {
                if (sql.includes("DELETE FROM generations WHERE user_id")) {
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
  });

  it("optionally deletes the Oxen playground file when removing one item", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const { bucket } = createMockR2();
    const db = libraryDb([
      {
        id: "gen-1",
        status: "succeeded",
        result_url:
          "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/ws/files/a.png",
      },
    ]);
    const env = createEnv({ DB: db.db, MEDIA: bucket });
    const result = await removeStudioGeneration(env, TEST_USER.id, db.generations[0]!, {
      apiKey: "oxen_test_key",
      fromOxen: true,
    });
    expect(result.oxenDeleted).toBe(1);
    expect(calls).toEqual([
      "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/ws/files",
    ]);
    expect(db.generations).toHaveLength(0);
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
  });

  it("skips R2 HEADs for thumbs that already exist unless rebuilding oversized files", () => {
    expect(thumbIsReusable({ size: 400_000 }, false)).toBe(true);
    expect(thumbIsReusable({ size: 400_000 }, true)).toBe(false);
    expect(thumbIsReusable({ size: THUMB_MAX_BYTES }, true)).toBe(true);
    expect(thumbIsReusable(null, false)).toBe(false);
  });
});
