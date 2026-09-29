import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { TEST_SECRET, TEST_SESSION_ID, TEST_USER, createEnv, createMockDb } from "./helpers";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const COOKIE = { Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}` };

describe("API error responses", () => {
  // D1/R2/GitHub errors can describe schema and infrastructure; the browser gets a reference only.
  it("hides internal error detail behind a reference id", async () => {
    const db = {
      prepare() {
        throw new Error("D1_ERROR: no such column: oxen_key_ciphertext_secret SQLITE_ERROR");
      },
    } as unknown as D1Database;
    const res = await app.request(
      "https://studio.digisavvy.dev/api/generations?scope=library",
      { headers: COOKIE },
      createEnv({ DB: db }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/^Something went wrong \(ref [0-9a-f]{8}\)$/);
    expect(body.error).not.toContain("SQLITE");
  });

  // Oxen's reason (credits, moderation) is about the user's own request and they need to see it.
  it("still passes Oxen's own error message through", async () => {
    const sealed = await encryptSecret("sk-user", TEST_SECRET);
    const user = { ...TEST_USER, oxen_key_ciphertext: sealed.ciphertext, oxen_key_iv: sealed.iv };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await app.request(
      "https://studio.digisavvy.dev/api/models/favorites",
      { headers: COOKIE },
      createEnv({ DB: createMockDb(user, TEST_SESSION_ID) }),
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("Insufficient credits");
  });

  it("uses the bundled Seed Audio schema when live model detail fails", async () => {
    const sealed = await encryptSecret("sk-user", TEST_SECRET);
    const user = { ...TEST_USER, oxen_key_ciphertext: sealed.ciphertext, oxen_key_iv: sealed.iv };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "upstream down" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const res = await app.request(
      "https://studio.digisavvy.dev/api/models/bytedance-seed-audio-1-0",
      { headers: COOKIE },
      createEnv({ DB: createMockDb(user, TEST_SESSION_ID) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model: { id: string };
      controls: { sampleRate?: { defaultValue?: string }; outputFormat?: string[] };
    };
    expect(body.model.id).toBe("bytedance-seed-audio-1-0");
    expect(body.controls.outputFormat?.[0]).toBe("mp3");
    expect(body.controls.sampleRate?.defaultValue).toBe("24000");
  });
});
