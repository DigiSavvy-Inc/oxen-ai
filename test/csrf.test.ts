import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { TEST_SESSION_ID, createEnv } from "./helpers";

const COOKIE = `${SESSION_COOKIE}=${TEST_SESSION_ID}`;

function logout(origin?: string, env = createEnv()) {
  const headers: Record<string, string> = { Cookie: COOKIE, "Content-Type": "text/plain" };
  if (origin) headers.Origin = origin;
  return app.request(
    "https://studio.digisavvy.dev/api/auth/logout",
    { method: "POST", headers, body: "{}" },
    env,
  );
}

describe("cross-origin write guard", () => {
  // A compromised sibling subdomain is same-site, so SameSite=Lax still sends the
  // session cookie. Only Studio's own origin may drive state changes.
  it("blocks a same-site subdomain posting with the session cookie", async () => {
    const res = await logout("https://www.digisavvy.dev");
    expect(res.status).toBe(403);
  });

  it("blocks opaque origins from sandboxed frames", async () => {
    const res = await logout("null");
    expect(res.status).toBe(403);
  });

  it("allows Studio's own origin", async () => {
    const res = await logout("https://studio.digisavvy.dev");
    expect(res.status).toBe(200);
  });

  it("allows the configured public origin", async () => {
    const env = createEnv({ PUBLIC_BASE_URL: "https://studio.digisavvy.dev/" });
    const res = await app.request(
      "https://oxen-studio.example.workers.dev/api/auth/logout",
      { method: "POST", headers: { Cookie: COOKIE, Origin: "https://studio.digisavvy.dev" } },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("allows non-browser clients that send no Origin", async () => {
    const res = await logout(undefined);
    expect(res.status).toBe(200);
  });

  it("leaves safe reads alone", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/health",
      { headers: { Origin: "https://evil.example" } },
      createEnv(),
    );
    expect(res.status).toBe(200);
  });
});
