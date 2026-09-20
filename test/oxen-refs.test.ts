import { describe, expect, it } from "vitest";
import {
  isOxenHostedMediaUrl,
  rewriteRefsToOxenSources,
  studioMediaKeyFromUrl,
} from "../worker/oxen-refs";

const KEY = "u/user-1/results/sheet.png";
const STUDIO_URL = `https://studio.digisavvy.dev/api/media/${KEY}?exp=1&sig=abc`;
const OXEN_URL = "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/file.png";

function dbWithOxenSource(userId: string, key: string, resultUrl: string | null): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (
                sql.includes("FROM generations") &&
                args[0] === userId &&
                (args[1] === key || args[2] === key)
              ) {
                return { result_url: resultUrl };
              }
              return null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("studioMediaKeyFromUrl", () => {
  it("reads the object key from a signed Studio media URL", () => {
    expect(studioMediaKeyFromUrl(STUDIO_URL)).toBe(KEY);
    expect(studioMediaKeyFromUrl(`/api/media/${KEY}`)).toBe(KEY);
    expect(studioMediaKeyFromUrl("data:image/png;base64,abc")).toBeNull();
    expect(studioMediaKeyFromUrl(OXEN_URL)).toBeNull();
  });
});

describe("isOxenHostedMediaUrl", () => {
  it("accepts only https hub.oxen.ai URLs", () => {
    expect(isOxenHostedMediaUrl(OXEN_URL)).toBe(true);
    expect(isOxenHostedMediaUrl(STUDIO_URL)).toBe(false);
    expect(isOxenHostedMediaUrl("http://hub.oxen.ai/file.png")).toBe(false);
  });
});

describe("rewriteRefsToOxenSources", () => {
  it("swaps Studio library copies for the stored Oxen result URL", async () => {
    const db = dbWithOxenSource("user-1", KEY, OXEN_URL);
    await expect(rewriteRefsToOxenSources(db, "user-1", [STUDIO_URL])).resolves.toEqual([OXEN_URL]);
  });

  it("leaves uploads and missing rows unchanged", async () => {
    const db = dbWithOxenSource("user-1", KEY, null);
    const upload = "https://studio.digisavvy.dev/api/media/u/user-1/drop.png?exp=1&sig=x";
    await expect(rewriteRefsToOxenSources(db, "user-1", [upload, STUDIO_URL])).resolves.toEqual([
      upload,
      STUDIO_URL,
    ]);
  });
});
