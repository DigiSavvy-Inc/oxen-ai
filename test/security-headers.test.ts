import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { createSignedMediaUrl } from "../worker/media";
import { TEST_SECRET, createEnv, createMockR2 } from "./helpers";

describe("API security headers", () => {
  it("locks down every API response", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/health", {}, createEnv());
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });

  // Uploaded media is served same-origin; if it is HTML/SVG it must not run script.
  it("serves stored media under a no-script CSP", async () => {
    const { store, bucket } = createMockR2();
    store.set("u/user-1/evil.html", {
      body: new TextEncoder().encode("<script>alert(1)</script>").buffer as ArrayBuffer,
      contentType: "text/html",
    });
    const env = createEnv({ MEDIA: bucket, PUBLIC_BASE_URL: "https://studio.digisavvy.dev" });
    const url = await createSignedMediaUrl("https://studio.digisavvy.dev", "u/user-1/evil.html", TEST_SECRET);
    const res = await app.request(url, {}, env);
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
  });

  it("still applies to error responses", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/generations", {}, createEnv());
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("static asset headers (public/_headers)", () => {
  const rules = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const csp = rules.match(/Content-Security-Policy: (.+)/)?.[1] ?? "";

  it("only runs same-origin scripts and cannot be framed", () => {
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  // Other digisavvy.dev sites are not all HTTPS; includeSubDomains would break them.
  it("sends HSTS without includeSubDomains", () => {
    expect(rules.match(/Strict-Transport-Security: (.+)/)?.[1]).toBe("max-age=31536000");
  });
});
