import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import { app } from "../worker/index";
import {
  generationNotifyCopy,
  shouldNotifyStatusChange,
} from "../worker/notify-copy";
import { parsePushSubscription, vapidConfigured } from "../worker/push";
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
        endpoint: "https://push.example/sub",
        keys: { p256dh: "abc", auth: "def" },
      }),
    ).toEqual({
      endpoint: "https://push.example/sub",
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
          endpoint: "https://push.example/sub",
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
          endpoint: "https://push.example/sub",
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
