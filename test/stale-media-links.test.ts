import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { createSignedMediaUrl, mediaSignatureState } from "../worker/media";
import { resetModelDetailCache } from "../worker/oxen";
import type { UserRow } from "../worker/types";
import {
  expiringMediaRefs,
  mediaLinkExpiry,
  withLiveMediaRefs,
} from "../src/lib/media-links";
import { gallerySlotSrc } from "../src/lib/gallery-thumbs";
import { TEST_SECRET, TEST_SESSION_ID, TEST_USER, createEnv, createMockR2 } from "./helpers";

const ORIGIN = "https://studio.digisavvy.dev";
const THUMB_KEY = "u/user-1/thumbs/still.png";
const REF_KEY = "u/user-1/galleries/face.png";
const OTHER_KEY = "u/user-2/thumbs/still.png";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const COOKIE = `${SESSION_COOKIE}=${TEST_SESSION_ID}`;
const HOUR = 60 * 60;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetModelDetailCache();
});

function sessionDb(user: UserRow): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM sessions") && args[0] === TEST_SESSION_ID) return user;
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

async function studioEnv() {
  const { bucket } = createMockR2();
  for (const key of [THUMB_KEY, REF_KEY, OTHER_KEY]) {
    await bucket.put(key, PNG.buffer, { httpMetadata: { contentType: "image/png" } });
  }
  const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
  const user: UserRow = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
  return createEnv({ MEDIA: bucket, PUBLIC_BASE_URL: ORIGIN, DB: sessionDb(user) });
}

/** A link Studio signed twelve hours before a tab that is still open used it. */
function expiredLink(key: string) {
  return createSignedMediaUrl(ORIGIN, key, TEST_SECRET, -HOUR);
}

function mockOxen() {
  const state: { queued: Record<string, unknown> | null } = { queued: null };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://hub.oxen.ai/api/ai/models/bytedance-seedream-5-pro") {
      return Response.json({
        id: "bytedance-seedream-5-pro",
        display_name: "Seedream 5.0 Pro",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
        request_schema: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            input_image: { type: "array", maxItems: 10, items: { type: "string" } },
          },
        },
      });
    }
    if (url === "https://hub.oxen.ai/api/ai/queue" && init?.method === "POST") {
      state.queued = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({ generations: [{ generation_id: "gen-1", status: "queued" }] });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  }) as typeof fetch;
  return state;
}

function submitBody(images: string[]): Record<string, unknown> {
  return {
    mode: "image-to-image",
    model: "bytedance-seedream-5-pro",
    prompt: "place @Image1 in a studio",
    num_generations: 1,
    images,
  };
}

function submit(env: Awaited<ReturnType<typeof studioEnv>>, body: Record<string, unknown>) {
  return app.request(
    `${ORIGIN}/api/generate`,
    {
      method: "POST",
      headers: { Cookie: COOKIE, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

function renew(env: Awaited<ReturnType<typeof studioEnv>>, urls: unknown, cookie: string | null = COOKIE) {
  return app.request(
    `${ORIGIN}/api/media/renew`,
    {
      method: "POST",
      headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    },
    env,
  );
}

describe("a gallery thumbnail whose link expired in an open tab", () => {
  it("still loads for the signed-in owner, as the gallery card requests it", async () => {
    const env = await studioEnv();
    const tile = gallerySlotSrc(await expiredLink(THUMB_KEY), "tile");
    expect(new URL(tile).searchParams.get("w")).toBe("160");

    const res = await app.request(tile, { headers: { Cookie: COOKIE } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(PNG));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("stays closed to everyone else", async () => {
    const env = await studioEnv();
    const expired = await expiredLink(THUMB_KEY);

    const anonymous = await app.request(expired, {}, env);
    expect(anonymous.status).toBe(403);

    const stranger = await app.request(
      expired,
      { headers: { Cookie: `${SESSION_COOKIE}=not-a-session` } },
      env,
    );
    expect(stranger.status).toBe(403);

    const otherUsersFile = await app.request(
      await expiredLink(OTHER_KEY),
      { headers: { Cookie: COOKIE } },
      env,
    );
    expect(otherUsersFile.status).toBe(403);
  });

  it("does not let a session stand in for a signature Studio never made", async () => {
    const env = await studioEnv();
    const forged = new URL(await expiredLink(THUMB_KEY));
    forged.searchParams.set("sig", "0".repeat(forged.searchParams.get("sig")?.length ?? 64));
    const unsigned = `${ORIGIN}/api/media/${THUMB_KEY}`;
    const wrongSecret = await createSignedMediaUrl(ORIGIN, THUMB_KEY, "another-secret", -HOUR);
    for (const url of [forged.toString(), unsigned, wrongSecret]) {
      const res = await app.request(url, { headers: { Cookie: COOKIE } }, env);
      expect(res.status).toBe(403);
    }
  });

  it("keeps a live link public and cacheable until it expires", async () => {
    const env = await studioEnv();
    const res = await app.request(await createSignedMediaUrl(ORIGIN, THUMB_KEY, TEST_SECRET), {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^public, max-age=\d+, immutable$/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("a job submitted with a reference whose link expired", () => {
  it("is refused with a message that says what happened, and nothing is queued", async () => {
    const env = await studioEnv();
    const oxen = mockOxen();
    const res = await submit(env, submitBody([await expiredLink(REF_KEY)]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/reference link expired/i);
    expect(oxen.queued).toBeNull();
  });

  it("queues once the composer has exchanged the link for a live one", async () => {
    const env = await studioEnv();
    const oxen = mockOxen();
    const stale = await expiredLink(REF_KEY);
    let renewCalls = 0;
    const body = await withLiveMediaRefs(submitBody([stale]), async (urls) => {
      renewCalls += 1;
      const res = await renew(env, urls);
      expect(res.status).toBe(200);
      return ((await res.json()) as { urls: (string | null)[] }).urls;
    });
    expect(renewCalls).toBe(1);

    const [sent] = body.images as string[];
    expect(sent).not.toBe(stale);
    const parsed = new URL(sent ?? "");
    expect(parsed.pathname).toBe(`/api/media/${REF_KEY}`);
    expect(
      await mediaSignatureState(
        REF_KEY,
        parsed.searchParams.get("exp") ?? "",
        parsed.searchParams.get("sig") ?? "",
        TEST_SECRET,
      ),
    ).toBe("valid");

    const res = await submit(env, body);
    expect(res.status).toBe(200);
    expect(oxen.queued).not.toBeNull();
    const queuedImages = (oxen.queued as unknown as { input_image?: string[] }).input_image ?? [];
    expect(queuedImages).toHaveLength(1);
    expect(queuedImages[0]?.startsWith(`${ORIGIN}/api/media/${REF_KEY}?`)).toBe(true);
  });

  it("renews only this user's links that Studio signed", async () => {
    const env = await studioEnv();
    const mine = await expiredLink(REF_KEY);
    const theirs = await expiredLink(OTHER_KEY);
    const forged = await createSignedMediaUrl(ORIGIN, REF_KEY, "another-secret", -HOUR);
    const unsigned = `${ORIGIN}/api/media/${REF_KEY}`;
    const hub = "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/a.jpg";
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";

    const res = await renew(env, [mine, theirs, forged, unsigned, hub, dataUri]);
    expect(res.status).toBe(200);
    const { urls } = (await res.json()) as { urls: (string | null)[] };
    expect(urls[0]).not.toBe(mine);
    expect(urls[0]?.startsWith(`${ORIGIN}/api/media/${REF_KEY}?`)).toBe(true);
    expect(urls.slice(1)).toEqual([null, null, null, hub, dataUri]);
  });

  it("needs a session and a short list of links to renew", async () => {
    const env = await studioEnv();
    const mine = await expiredLink(REF_KEY);
    expect((await renew(env, [mine], null)).status).toBe(401);
    expect((await renew(env, "not-a-list")).status).toBe(400);
    expect((await renew(env, Array.from({ length: 65 }, () => mine))).status).toBe(400);
  });
});

describe("withLiveMediaRefs", () => {
  const now = 1_800_000_000;
  const link = (key: string, exp: number) => `${ORIGIN}/api/media/${key}?exp=${exp}&sig=abc`;

  it("reads the expiry of Studio links only", () => {
    expect(mediaLinkExpiry(link("u/a/1.png", now))).toBe(now);
    expect(mediaLinkExpiry(`/api/media/u/a/1.png?exp=${now}&sig=abc`)).toBe(now);
    expect(mediaLinkExpiry("https://hub.oxen.ai/file.png?exp=5")).toBeNull();
    expect(mediaLinkExpiry("data:image/png;base64,AAAA")).toBeNull();
    expect(mediaLinkExpiry(`${ORIGIN}/api/media/u/a/1.png`)).toBeNull();
  });

  it("exchanges expired and nearly expired links in every reference field", async () => {
    const expired = link("u/a/old.png", now - 60);
    const closing = link("u/a/closing.mp4", now + 60);
    const live = link("u/a/live.png", now + 6 * HOUR);
    const body = {
      prompt: `keep ${expired} in the prompt as typed`,
      images: [expired, live, "data:image/png;base64,AAAA"],
      input_video: closing,
      audios: [live],
    };
    expect(expiringMediaRefs(body, now).sort()).toEqual([closing, expired].sort());

    const asked: string[][] = [];
    const next = await withLiveMediaRefs(
      body,
      async (urls) => {
        asked.push(urls);
        return urls.map((url) => `${url}&renewed=1`);
      },
      now,
    );
    expect(asked).toEqual([[expired, closing]]);
    expect(next.images).toEqual([`${expired}&renewed=1`, live, "data:image/png;base64,AAAA"]);
    expect(next.input_video).toBe(`${closing}&renewed=1`);
    expect(next.audios).toEqual([live]);
    expect(next.prompt).toBe(body.prompt);
    expect(body.images[0]).toBe(expired);
  });

  it("asks for nothing when every link is live", async () => {
    const body = { images: [link("u/a/live.png", now + 6 * HOUR)] };
    const next = await withLiveMediaRefs(
      body,
      async () => {
        throw new Error("renew should not be called");
      },
      now,
    );
    expect(next).toBe(body);
  });

  it("sends the request as it is when a link cannot be renewed", async () => {
    const body = { images: [link("u/a/old.png", now - 60)] };
    expect(await withLiveMediaRefs(body, async () => [null], now)).toBe(body);
    expect(
      await withLiveMediaRefs(
        body,
        async () => {
          throw new Error("offline");
        },
        now,
      ),
    ).toBe(body);
  });
});
