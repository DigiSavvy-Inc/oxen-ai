import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { NATIVE_COOKIE, openHandoff, sealHandoff } from "../worker/native-auth";
import { TEST_SECRET, TEST_USER, createEnv } from "./helpers";

const VERIFIER = "v".repeat(43);
const NOW = 1_800_000_000;

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function codeFor(verifier = VERIFIER, now?: number) {
  return sealHandoff(
    { userId: TEST_USER.id, github: null, challenge: await challengeFor(verifier) },
    TEST_SECRET,
    now,
  );
}

function redeem(body: unknown, headers: Record<string, string> = { "X-Studio-Native": "1" }) {
  return app.request(
    "https://studio.digisavvy.dev/api/auth/native",
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
    createEnv(),
  );
}

describe("native sign-in handoff code", () => {
  it("opens for the app that started the sign-in", async () => {
    const opened = await openHandoff(await codeFor(VERIFIER, NOW), VERIFIER, TEST_SECRET, NOW + 30);
    expect(opened).toEqual({ userId: TEST_USER.id, github: null });
  });

  // Any app can claim the oxenstudio:// scheme and catch the redirect. Without the
  // verifier the code it catches must not become a session.
  it("is worthless to an app that intercepted the redirect", async () => {
    const code = await codeFor(VERIFIER, NOW);
    expect(await openHandoff(code, "x".repeat(43), TEST_SECRET, NOW)).toBeNull();
  });

  it("expires after two minutes", async () => {
    const code = await codeFor(VERIFIER, NOW);
    expect(await openHandoff(code, VERIFIER, TEST_SECRET, NOW + 121)).toBeNull();
  });

  it("rejects a code sealed with another key", async () => {
    const code = await codeFor(VERIFIER, NOW);
    expect(await openHandoff(code, VERIFIER, "other-key", NOW)).toBeNull();
  });

  it("refuses to mint codes without an encryption key", async () => {
    await expect(
      sealHandoff({ userId: TEST_USER.id, github: null, challenge: await challengeFor(VERIFIER) }, " "),
    ).rejects.toThrow();
  });
});

describe("POST /api/auth/native", () => {
  it("sets the session cookie for a valid code and verifier", async () => {
    const res = await redeem({ code: await codeFor(), verifier: VERIFIER });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=`);
  });

  // Login CSRF: a web page must not be able to sign a visitor into someone else's account.
  it("refuses requests without the native header", async () => {
    const res = await redeem({ code: await codeFor(), verifier: VERIFIER }, {});
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses a wrong verifier without setting a cookie", async () => {
    const res = await redeem({ code: await codeFor(), verifier: "x".repeat(43) });
    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("GET /api/auth/github", () => {
  const env = () => createEnv({ GITHUB_CLIENT_ID: "Iv1.realclient", GITHUB_CLIENT_SECRET: "real-secret" });

  it("remembers the app's challenge across the GitHub round trip", async () => {
    const challenge = await challengeFor(VERIFIER);
    const res = await app.request(`https://studio.digisavvy.dev/api/auth/github?native=${challenge}`, {}, env());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("https://github.com/login/oauth/authorize");
    expect(res.headers.get("Set-Cookie")).toContain(`${NATIVE_COOKIE}=${challenge}`);
  });

  // Otherwise an abandoned app sign-in would send the next browser sign-in to the app.
  it("clears a leftover challenge on an ordinary browser sign-in", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/auth/github", {}, env());
    expect(res.headers.get("Set-Cookie")).toMatch(new RegExp(`${NATIVE_COOKIE}=;`));
  });
});
