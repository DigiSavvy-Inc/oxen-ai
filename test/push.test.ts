import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import { app } from "../worker/index";
import {
  generationNotifyCopy,
  shouldNotifyStatusChange,
} from "../worker/notify-copy";
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  isPushServiceEndpoint,
  parsePushSubscription,
  savePushSubscription,
  vapidConfigured,
} from "../worker/push";
import { createEnv, TEST_SESSION_ID } from "./helpers";

function cookieHeader() {
  return `${SESSION_COOKIE}=${TEST_SESSION_ID}`;
}

describe("shouldNotifyStatusChange", () => {
  it("fires only when a job first reaches succeeded or failed", () => {
    expect(shouldNotifyStatusChange("queued", "succeeded")).toBe(true);
    expect(shouldNotifyStatusChange("processing", "failed")).toBe(true);
    expect(shouldNotifyStatusChange("succeeded", "succeeded")).toBe(false);
    expect(shouldNotifyStatusChange("failed", "succeeded")).toBe(false);
    expect(shouldNotifyStatusChange("queued", "processing")).toBe(false);
    expect(shouldNotifyStatusChange("cancelled", "failed")).toBe(false);
  });
});

describe("generationNotifyCopy", () => {
  it("summarizes a finished image", () => {
    expect(
      generationNotifyCopy({
        id: "gen-1",
        status: "succeeded",
        prompt: "a quiet kitchen at dusk",
        mediaType: "image",
        errorMessage: null,
      }),
    ).toEqual({
      title: "Image is ready",
      body: "a quiet kitchen at dusk",
      tag: "gen-1",
      url: "/",
    });
  });

  it("uses the Oxen error for a failed video", () => {
    expect(
      generationNotifyCopy({
        id: "gen-2",
        status: "failed",
        prompt: "unused",
        mediaType: "video",
        errorMessage: "safety filter",
      }),
    ).toMatchObject({
      title: "Video generation failed",
      body: "safety filter",
      tag: "gen-2",
    });
  });
});

describe("parsePushSubscription", () => {
  it("requires an https endpoint and both keys", () => {
    expect(() => parsePushSubscription(null)).toThrow("Invalid push subscription");
    expect(() =>
      parsePushSubscription({
        endpoint: "http://example.com/push",
        keys: { p256dh: "a", auth: "b" },
      }),
    ).toThrow("Invalid push subscription");
    expect(
      parsePushSubscription({
        endpoint: "https://fcm.googleapis.com/fcm/send/test-sub",
        keys: { p256dh: "abc", auth: "def" },
      }),
    ).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/test-sub",
      keys: { p256dh: "abc", auth: "def" },
    });
  });
});

describe("vapidConfigured", () => {
  it("needs both public and private keys", () => {
    expect(vapidConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" })).toBe(true);
    expect(vapidConfigured({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "" })).toBe(false);
    expect(vapidConfigured({})).toBe(false);
  });
});

describe("GET /api/push/config", () => {
  it("requires a session", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/push/config", {}, createEnv());
    expect(res.status).toBe(401);
  });

  it("hides the public key when VAPID is unset", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/push/config",
      { headers: { Cookie: cookieHeader() } },
      createEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      vapidPublicKey: null,
      subscribed: false,
    });
  });

  it("returns the public key when VAPID is configured", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/push/config",
      { headers: { Cookie: cookieHeader() } },
      createEnv({ VAPID_PUBLIC_KEY: "public-test-key", VAPID_PRIVATE_KEY: "private-test-key" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      vapidPublicKey: "public-test-key",
      subscribed: false,
    });
  });
});

describe("POST /api/push/subscribe", () => {
  it("rejects subscribe when VAPID is missing", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/push/subscribe",
      {
        method: "POST",
        headers: { Cookie: cookieHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://fcm.googleapis.com/fcm/send/test-sub",
          keys: { p256dh: "abc", auth: "def" },
        }),
      },
      createEnv(),
    );
    expect(res.status).toBe(503);
  });

  it("stores a valid subscription", async () => {
    const env = createEnv({
      VAPID_PUBLIC_KEY: "public-test-key",
      VAPID_PRIVATE_KEY: "private-test-key",
    });
    const sql: string[] = [];
    const original = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((query: string) => {
      sql.push(query);
      return original(query);
    }) as D1Database["prepare"];

    const res = await app.request(
      "https://studio.digisavvy.dev/api/push/subscribe",
      {
        method: "POST",
        headers: { Cookie: cookieHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://fcm.googleapis.com/fcm/send/test-sub",
          keys: { p256dh: "abc", auth: "def" },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sql.some((query) => query.includes("INSERT INTO push_subscriptions"))).toBe(true);
  });
});

describe("DELETE /api/push/subscribe", () => {
  it("requires an endpoint", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/push/subscribe",
      {
        method: "DELETE",
        headers: { Cookie: cookieHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      createEnv(),
    );
    expect(res.status).toBe(400);
  });
});

describe("push endpoint allowlist", () => {
  // The Worker POSTs to every stored endpoint; only real browser push services qualify.
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-bl2p.notify.windows.com/w/?token=abc",
  ])("accepts %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "https://evil.example/collect",
    "https://fcm.googleapis.com.evil.example/x",
    "https://notfcm.googleapis.com/x",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://169.254.169.254/latest",
  ])("rejects %s", (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
    expect(() =>
      parsePushSubscription({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    ).toThrow();
  });

  it("rejects oversized keys", () => {
    expect(() =>
      parsePushSubscription({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "p".repeat(257), auth: "a" },
      }),
    ).toThrow();
  });
});

describe("push subscriptions per account", () => {
  it(`keeps only the newest ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} devices per account`, async () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
    raw.exec(readFileSync(new URL("../migrations/0006_push_subscriptions.sql", import.meta.url), "utf8"));
    raw.exec(
      `INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES ('u1', 1, 'a', 0, 0), ('u2', 2, 'b', 0, 0)`,
    );
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: (string | number)[]) {
            return {
              async first() {
                return raw.prepare(sql).get(...args) ?? null;
              },
              async run() {
                raw.prepare(sql).run(...args);
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER + 5; i++) {
      await savePushSubscription(db, "u1", {
        endpoint: `https://fcm.googleapis.com/fcm/send/device-${i}`,
        keys: { p256dh: "p", auth: "a" },
      });
    }
    await savePushSubscription(db, "u2", {
      endpoint: "https://fcm.googleapis.com/fcm/send/other",
      keys: { p256dh: "p", auth: "a" },
    });
    const count = (user: string) =>
      (raw.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?`).get(user) as { n: number }).n;
    expect(count("u1")).toBe(MAX_PUSH_SUBSCRIPTIONS_PER_USER);
    expect(count("u2")).toBe(1);
  });
});
