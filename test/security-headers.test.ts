import { readFileSync, readdirSync } from "node:fs";
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
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
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

  // Resolves the headers Cloudflare sends for a path, the way it reads this file: every
  // matching block applies in file order, "! Name" drops what earlier blocks set, and a
  // name set by two blocks is joined with a comma.
  function headersFor(path: string): Map<string, string> {
    const blocks: { pattern: string; lines: string[] }[] = [];
    for (const raw of rules.split("\n")) {
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      if (/^\s/.test(raw)) blocks[blocks.length - 1].lines.push(raw.trim());
      else blocks.push({ pattern: raw.trim(), lines: [] });
    }
    const headers = new Map<string, string>();
    const setByFile = new Set<string>();
    for (const { pattern, lines } of blocks) {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      if (!new RegExp(`^${escaped}$`).test(path)) continue;
      for (const line of lines.filter((l) => l.startsWith("! "))) headers.delete(line.slice(2).trim().toLowerCase());
      for (const line of lines.filter((l) => !l.startsWith("! "))) {
        const name = line.slice(0, line.indexOf(":")).trim().toLowerCase();
        const value = line.slice(line.indexOf(":") + 1).trim();
        const earlier = headers.get(name);
        headers.set(name, setByFile.has(name) && earlier ? `${earlier}, ${value}` : value);
        setByFile.add(name);
      }
    }
    return headers;
  }
  const cacheControl = (path: string) => headersFor(path).get("cache-control");

  it("only runs same-origin scripts and cannot be framed", () => {
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  // A proxy that may rewrite the page (Cloudflare's Web Analytics does) injects a third-party
  // script the CSP then blocks on every load. no-transform tells it to leave the HTML alone.
  it("tells proxies not to rewrite the page, and still revalidates every load", () => {
    for (const path of ["/", "/index.html", "/gallery", "/slots/some-id"]) {
      expect(cacheControl(path), path).toBe("public, max-age=0, must-revalidate, no-transform");
    }
  });

  // no-transform also stops Cloudflare compressing the response. On the JS and CSS bundle that
  // is about 490 KB more on every first load, so only the HTML page may carry it.
  it("keeps no-transform off everything that is not the page, so it is still compressed", () => {
    const compressible = [
      "/assets/index-BE0y26e2.js",
      "/assets/index-5_9Rkcug.css",
      "/assets/chunks/any-Dk3f.js",
      "/sw.js",
      ...readdirSync(new URL("../public/", import.meta.url))
        .filter((name) => name.endsWith(".svg"))
        .map((name) => `/${name}`),
    ];
    expect(compressible).toEqual(expect.arrayContaining(["/favicon.svg", "/icons.svg", "/oxen-logo.svg"]));
    for (const path of compressible) {
      expect(cacheControl(path), path).toBe("public, max-age=0, must-revalidate");
    }
  });

  it("gives every static response the same CSP and framing rules", () => {
    for (const path of ["/", "/assets/index-BE0y26e2.js", "/sw.js", "/favicon.svg"]) {
      const headers = headersFor(path);
      expect(headers.get("content-security-policy"), path).toBe(csp);
      expect(headers.get("x-frame-options"), path).toBe("DENY");
    }
  });

  // Other digisavvy.dev sites are not all HTTPS; includeSubDomains would break them.
  it("sends HSTS without includeSubDomains", () => {
    expect(rules.match(/Strict-Transport-Security: (.+)/)?.[1]).toBe("max-age=31536000");
  });
});
