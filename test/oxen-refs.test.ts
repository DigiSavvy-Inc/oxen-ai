import { describe, expect, it } from "vitest";
import {
  collectOxenRefs,
  inlineStudioMediaRefs,
  isOxenHostedMediaUrl,
  resolveRefsForOxen,
  rewriteRefsToOxenSources,
  studioMediaKeyFromUrl,
} from "../worker/oxen-refs";
import { createMockR2 } from "./helpers";

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

describe("inlineStudioMediaRefs", () => {
  it("turns Studio uploads into data URIs so Oxen does not fetch us", async () => {
    const { bucket } = createMockR2();
    const key = "u/user-1/drop.png";
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await bucket.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
    const upload = `https://studio.digisavvy.dev/api/media/${key}?exp=1&sig=x`;
    await expect(inlineStudioMediaRefs(bucket, [upload, OXEN_URL])).resolves.toEqual([
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      OXEN_URL,
    ]);
  });

  it("leaves character refs as https because Seedance face upload rejects data URIs", async () => {
    const { bucket } = createMockR2();
    const key = "u/user-1/face.png";
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await bucket.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
    const upload = `https://studio.digisavvy.dev/api/media/${key}?exp=1&sig=x`;
    const scene = `https://studio.digisavvy.dev/api/media/u/user-1/room.png?exp=1&sig=y`;
    await bucket.put("u/user-1/room.png", bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    await expect(
      inlineStudioMediaRefs(bucket, [upload, scene], { keepHttps: [true, false] }),
    ).resolves.toEqual([
      upload,
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    ]);
  });

  it("keeps the signed URL when the object is too large", async () => {
    const { bucket } = createMockR2();
    const key = "u/user-1/huge.png";
    await bucket.put(key, new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    const upload = `https://studio.digisavvy.dev/api/media/${key}?exp=1&sig=x`;
    await expect(inlineStudioMediaRefs(bucket, [upload], { maxBytes: 2 })).resolves.toEqual([
      upload,
    ]);
  });
});

describe("collectOxenRefs", () => {
  it("keeps character and declared face refs on https and inlines scene refs", () => {
    expect(
      collectOxenRefs([
        {
          urls: [" https://studio.example/a.png ", "https://studio.example/b.png"],
          roles: ["character", "scene"],
          face: true,
        },
        { urls: ["https://studio.example/plate.png"] },
        { urls: ["https://studio.example/hero.png"], face: true },
      ]),
    ).toEqual({
      urls: [
        "https://studio.example/a.png",
        "https://studio.example/b.png",
        "https://studio.example/plate.png",
        "https://studio.example/hero.png",
      ],
      keepHttps: [true, false, false, true],
    });
  });

  it("inlines every ref when the model has no face slot", () => {
    expect(
      collectOxenRefs([
        {
          urls: ["https://studio.example/a.png"],
          roles: ["character"],
          face: false,
        },
      ]),
    ).toEqual({
      urls: ["https://studio.example/a.png"],
      keepHttps: [false],
    });
  });
});

describe("resolveRefsForOxen", () => {
  it("prefers the stored Oxen result URL over inlining a library copy", async () => {
    const { bucket } = createMockR2();
    await bucket.put(KEY, new Uint8Array([9]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    const db = dbWithOxenSource("user-1", KEY, OXEN_URL);
    await expect(resolveRefsForOxen(db, bucket, "user-1", [STUDIO_URL])).resolves.toEqual([
      OXEN_URL,
    ]);
  });
});
