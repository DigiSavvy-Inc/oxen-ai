import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { createSignedMediaUrl } from "../worker/media";
import {
  TEST_SECRET,
  TEST_SESSION_ID,
  createEnv,
  createMockR2,
} from "./helpers";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function cookieHeader() {
  return `${SESSION_COOKIE}=${TEST_SESSION_ID}`;
}

async function upload(env: ReturnType<typeof createEnv>, cookie?: string) {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES], "ref.png", { type: "image/png" }));
  return app.request(
    "https://studio.digisavvy.dev/api/upload",
    {
      method: "POST",
      body: form,
      headers: cookie ? { Cookie: cookie } : undefined,
    },
    env,
  );
}

describe("POST /api/upload", () => {
  it("requires a session (browser does not send Oxen keys)", async () => {
    const res = await upload(createEnv(), undefined);
    expect(res.status).toBe(401);
  });

  it("returns a data URI when PUBLIC_BASE_URL is unset", async () => {
    const env = createEnv();
    const res = await upload(env, cookieHeader());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; contentType: string };
    expect(body.contentType).toBe("image/png");
    expect(body.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("returns a data URI when PUBLIC_BASE_URL is empty", async () => {
    const env = createEnv({ PUBLIC_BASE_URL: "" });
    const res = await upload(env, cookieHeader());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("returns a signed https URL Oxen can GET when PUBLIC_BASE_URL is set", async () => {
    const { bucket } = createMockR2();
    const env = createEnv({
      MEDIA: bucket,
      PUBLIC_BASE_URL: "https://studio.digisavvy.dev/",
    });
    const res = await upload(env, cookieHeader());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      key: string;
      url: string;
      contentType: string;
    };
    const parsed = new URL(body.url);
    expect(parsed.origin).toBe("https://studio.digisavvy.dev");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.pathname).toBe(`/api/media/${body.key}`);
    expect(parsed.searchParams.has("exp")).toBe(true);
    expect(parsed.searchParams.has("sig")).toBe(true);

    const mediaRes = await app.request(body.url, {}, env);
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await mediaRes.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(PNG_BYTES));
  });

  it("stores gallery uploads under the signed-in user's gallery prefix", async () => {
    const env = createEnv();
    const form = new FormData();
    form.append("file", new File([PNG_BYTES], "hero.png", { type: "image/png" }));
    form.append("folder", "galleries");
    const res = await app.request(
      "https://studio.digisavvy.dev/api/upload",
      { method: "POST", body: form, headers: { Cookie: cookieHeader() } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("u/user-1/galleries/")).toBe(true);
  });
});

describe("GET /api/media/*", () => {
  it("serves R2 bytes after verifying exp+sig without a session cookie", async () => {
    const { bucket, store } = createMockR2();
    const key = "u/user-1/clip.mp4";
    await bucket.put(key, new Uint8Array([1, 2, 3, 4]).buffer, {
      httpMetadata: { contentType: "video/mp4" },
    });
    const env = createEnv({ MEDIA: bucket });
    const signed = await createSignedMediaUrl(
      "https://studio.digisavvy.dev",
      key,
      TEST_SECRET,
    );
    expect(store.has(key)).toBe(true);

    const res = await app.request(signed, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toMatch(/public, max-age=\d+, immutable/);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it("rejects expired signatures before reading R2", async () => {
    const { bucket } = createMockR2();
    const key = "u/user-1/clip.mp4";
    await bucket.put(key, new Uint8Array([9]).buffer, {
      httpMetadata: { contentType: "video/mp4" },
    });
    const env = createEnv({ MEDIA: bucket });
    const signed = await createSignedMediaUrl(
      "https://studio.digisavvy.dev",
      key,
      TEST_SECRET,
      -10,
    );
    const res = await app.request(signed, {}, env);
    expect(res.status).toBe(403);
  });
});
