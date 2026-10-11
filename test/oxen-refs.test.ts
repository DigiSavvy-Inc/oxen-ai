import { describe, expect, it } from "vitest";
import { createSignedMediaUrl } from "../worker/media";
import {
  collectOxenRefs,
  inlineStudioMediaRefs,
  isOxenHostedMediaUrl,
  OxenMediaInlineError,
  resolveRefsForOxen,
  rewriteRefsToOxenSources,
  StudioMediaRefRejected,
  studioMediaKeyFromUrl,
} from "../worker/oxen-refs";
import { createMockR2 } from "./helpers";

const SECRET = "test-secret";
const AUTH = { userId: "user-1", secret: SECRET };
const SIGNING = {
  publicBaseUrl: "https://studio.digisavvy.dev",
  secret: SECRET,
  userId: "user-1",
};

function signed(key: string, ttlSeconds?: number) {
  return createSignedMediaUrl("https://studio.digisavvy.dev", key, SECRET, ttlSeconds);
}

const KEY = "u/user-1/results/sheet.png";
const STUDIO_URL = `https://studio.digisavvy.dev/api/media/${KEY}?exp=1&sig=abc`;
const OXEN_URL = "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/file.png";
const HUB_PLAYGROUND_FILE =
  "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/input_example.jpg?exp=1&sig=test";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

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
    const upload = await signed(key);
    await expect(inlineStudioMediaRefs(bucket, [upload], { auth: AUTH })).resolves.toEqual([
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    ]);
  });

  it("does not forward a hub playground file URL in an image ref", async () => {
    const { bucket } = createMockR2();
    let fetched = 0;
    const [inlined] = await inlineStudioMediaRefs(bucket, [HUB_PLAYGROUND_FILE], {
      auth: AUTH,
      apiKey: "sk-test",
      fetchHub: async () => {
        fetched += 1;
        return { bytes: PNG.buffer, contentType: "application/octet-stream" };
      },
    });
    expect(fetched).toBe(1);
    expect(inlined.startsWith("data:image/png;base64,")).toBe(true);
    expect(inlined).not.toContain("hub.oxen.ai");
    expect(JSON.stringify([inlined])).not.toContain(HUB_PLAYGROUND_FILE);
  });

  it("inlines the Studio R2 copy of a hub file and does not download the hub URL", async () => {
    const { bucket } = createMockR2();
    await bucket.put(KEY, PNG.buffer, { httpMetadata: { contentType: "image/png" } });
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (!sql.includes("result_key")) return null;
                return { result_key: KEY };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    let fetched = 0;
    const [inlined] = await inlineStudioMediaRefs(bucket, [HUB_PLAYGROUND_FILE], {
      auth: AUTH,
      apiKey: "sk-test",
      db,
      fetchHub: async () => {
        fetched += 1;
        return { bytes: PNG.buffer, contentType: "image/png" };
      },
    });
    expect(fetched).toBe(0);
    expect(inlined).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
    expect(inlined).not.toContain("hub.oxen.ai");
  });

  it("fails in Studio when the hub download times out", async () => {
    const { bucket } = createMockR2();
    const attempt = inlineStudioMediaRefs(bucket, [HUB_PLAYGROUND_FILE], {
      auth: AUTH,
      apiKey: "sk-test",
      fetchHub: async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      },
    });
    await expect(attempt).rejects.toBeInstanceOf(OxenMediaInlineError);
    await expect(attempt).rejects.toThrow(/Timed out downloading the reference file/);
    try {
      await attempt;
    } catch (err) {
      expect(String(err)).not.toContain("hub.oxen.ai");
      expect(String(err)).not.toContain("sig=");
    }
  });

  it("leaves character refs as https because Seedance face upload rejects data URIs", async () => {
    const { bucket } = createMockR2();
    const key = "u/user-1/face.png";
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await bucket.put(key, bytes.buffer, { httpMetadata: { contentType: "image/png" } });
    const upload = await signed(key);
    const scene = await signed("u/user-1/room.png");
    await bucket.put("u/user-1/room.png", bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    await expect(
      inlineStudioMediaRefs(bucket, [upload, scene], { keepHttps: [true, false], auth: AUTH }),
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
    const upload = await signed(key);
    await expect(inlineStudioMediaRefs(bucket, [upload], { maxBytes: 2, auth: AUTH })).resolves.toEqual([
      upload,
    ]);
  });

  it("refuses an expired signature and another user's key", async () => {
    const { bucket } = createMockR2();
    const own = "u/user-1/own.png";
    const other = "u/user-2/other.png";
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    await bucket.put(own, bytes, { httpMetadata: { contentType: "image/png" } });
    await bucket.put(other, bytes, { httpMetadata: { contentType: "image/png" } });
    await expect(
      inlineStudioMediaRefs(bucket, [await signed(own, -30)], { auth: AUTH }),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
    await expect(
      inlineStudioMediaRefs(bucket, [await signed(other)], { auth: AUTH, keepHttps: [true] }),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
    await expect(
      inlineStudioMediaRefs(bucket, [`https://studio.digisavvy.dev/api/media/${own}`], { auth: AUTH }),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
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

  it("keeps every image ref on https when the caller asks, even without a face slot", () => {
    expect(
      collectOxenRefs([
        { urls: ["https://studio.example/a.png", "https://studio.example/b.png"], https: true },
      ]),
    ).toEqual({
      urls: ["https://studio.example/a.png", "https://studio.example/b.png"],
      keepHttps: [true, true],
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
  it("inlines a library copy so image models do not download hub.oxen.ai", async () => {
    const { bucket } = createMockR2();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await bucket.put(KEY, bytes.buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    const url = await signed(KEY);
    await expect(resolveRefsForOxen(bucket, [url], undefined, undefined, SIGNING)).resolves.toEqual([
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    ]);
  });

  it("keeps a Studio https URL for face slots instead of the hub file URL", async () => {
    const { bucket } = createMockR2();
    await bucket.put(KEY, new Uint8Array([9]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    const [url] = await resolveRefsForOxen(bucket, [await signed(KEY)], undefined, [true], SIGNING);
    expect(url.startsWith("data:")).toBe(false);
    expect(isOxenHostedMediaUrl(url)).toBe(false);
    expect(studioMediaKeyFromUrl(url)).toBe(KEY);
  });

  it("turns a data URI into a Studio https URL when the provider must fetch https", async () => {
    const { bucket } = createMockR2();
    const dataUri = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    const [url] = await resolveRefsForOxen(bucket, [dataUri], undefined, [true], SIGNING);
    expect(url.startsWith("data:")).toBe(false);
    expect(isOxenHostedMediaUrl(url)).toBe(false);
    expect(url.startsWith("https://studio.digisavvy.dev/api/media/u/user-1/")).toBe(true);
  });

  it("turns a hub file in a face slot into a Studio https URL", async () => {
    const { bucket } = createMockR2();
    const [url] = await resolveRefsForOxen(bucket, [HUB_PLAYGROUND_FILE], undefined, [true], {
      ...SIGNING,
      apiKey: "sk-test",
      fetchHub: async () => ({ bytes: PNG.buffer, contentType: "image/png" }),
    });
    expect(url.startsWith("data:")).toBe(false);
    expect(isOxenHostedMediaUrl(url)).toBe(false);
    expect(url.startsWith("https://studio.digisavvy.dev/api/media/u/user-1/")).toBe(true);
  });

  it("refuses expired and cross-user media refs before reading or re-signing them", async () => {
    const { bucket } = createMockR2();
    const other = "u/user-2/private.png";
    await bucket.put(KEY, new Uint8Array([1]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    await bucket.put(other, new Uint8Array([2]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    let reads = 0;
    const watched = new Proxy(bucket, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return async (key: string) => {
            reads += 1;
            return target.get(key);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(
      resolveRefsForOxen(watched, [await signed(KEY, -30)], undefined, [false], SIGNING),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
    await expect(
      resolveRefsForOxen(watched, [await signed(other)], undefined, [true], SIGNING),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
    expect(reads).toBe(0);
  });
});
