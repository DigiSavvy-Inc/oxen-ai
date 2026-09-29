import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import {
  acceptLogoBytes,
  DEFAULT_LOGO_PATH,
  DEFAULT_SITE_NAME,
  normalizeSiteName,
} from "../worker/branding";
import { app } from "../worker/index";
import { createEnv, createMockR2, TEST_SESSION_ID } from "./helpers";

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

const TINY_SVG = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#111"/></svg>`,
);

function sqliteD1(): D1Database {
  const raw = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  raw
    .prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url, oxen_key_ciphertext, oxen_key_iv, created_at, updated_at)
       VALUES ('user-1', 1, 'tester', 'Tester', NULL, NULL, NULL, 1, 1)`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'user-1', 2000000000, 1)`,
    )
    .run(TEST_SESSION_ID);
  raw
    .prepare(
      `INSERT INTO allowlist (github_login, github_id, added_by, created_at) VALUES ('tester', 1, 'admin', 1)`,
    )
    .run();

  const db = {
    prepare(sql: string) {
      const run = (...args: (string | number | null)[]) => {
        const stmt = raw.prepare(sql);
        return {
          async first() {
            return stmt.get(...args) ?? null;
          },
          async all() {
            return { results: stmt.all(...args) };
          },
          async run() {
            stmt.run(...args);
            return { success: true };
          },
        };
      };
      return {
        bind(...args: (string | number | null)[]) {
          return run(...args);
        },
        ...run(),
      };
    },
  };
  return db as unknown as D1Database;
}

function brandingEnv(admins: string) {
  const { bucket } = createMockR2();
  return createEnv({
    DB: sqliteD1(),
    MEDIA: bucket,
    GITHUB_ADMINS: admins,
    GITHUB_ORG: "",
  });
}

const cookie = `${SESSION_COOKIE}=${TEST_SESSION_ID}`;

describe("normalizeSiteName", () => {
  it("treats blank text as the default and keeps a saved name", () => {
    expect(normalizeSiteName("")).toEqual({ ok: true, name: null });
    expect(normalizeSiteName("   ")).toEqual({ ok: true, name: null });
    expect(normalizeSiteName(null)).toEqual({ ok: true, name: null });
    expect(normalizeSiteName("  DS Studio  ")).toEqual({ ok: true, name: "DS Studio" });
    expect(normalizeSiteName(1).ok).toBe(false);
  });
});

describe("acceptLogoBytes", () => {
  it("accepts a png or a plain svg and rejects html", () => {
    expect(acceptLogoBytes(TINY_PNG)).toEqual({ contentType: "image/png" });
    expect(acceptLogoBytes(TINY_SVG)).toEqual({ contentType: "image/svg+xml" });
    expect(
      acceptLogoBytes(new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>`)),
    ).toEqual({ error: "Logo must be a PNG, JPEG, WebP, GIF, or SVG" });
  });
});

describe("instance branding", () => {
  it("serves Oxen Studio and the bundled logo when nothing is saved", async () => {
    const env = brandingEnv("tester");
    const res = await app.request("https://studio.digisavvy.dev/api/branding", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: DEFAULT_SITE_NAME,
      savedName: null,
      logoUrl: DEFAULT_LOGO_PATH,
      logoType: "image/svg+xml",
      customLogo: false,
    });
    expect(DEFAULT_SITE_NAME).toBe("Oxen Studio");
    expect(readFileSync(new URL("../public/oxen-logo.svg", import.meta.url), "utf8")).toContain("<svg");
    expect(readFileSync(new URL("../index.html", import.meta.url), "utf8")).toContain("Oxen Studio");
  });

  it("lets an admin replace the name and logo, then return to the defaults", async () => {
    const env = brandingEnv("tester");
    const saved = await app.request(
      "https://studio.digisavvy.dev/api/branding",
      {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "DS Studio" }),
      },
      env,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      name: "DS Studio",
      savedName: "DS Studio",
      logoUrl: DEFAULT_LOGO_PATH,
      customLogo: false,
    });

    const logo = await app.request(
      "https://studio.digisavvy.dev/api/branding/logo",
      {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: TINY_PNG,
      },
      env,
    );
    expect(logo.status).toBe(200);
    const branded = (await logo.json()) as { name: string; logoUrl: string; customLogo: boolean; logoType: string };
    expect(branded).toMatchObject({
      name: "DS Studio",
      customLogo: true,
      logoType: "image/png",
    });
    expect(branded.logoUrl).toMatch(/^\/api\/branding\/logo\?v=/);

    const file = await app.request(`https://studio.digisavvy.dev${branded.logoUrl}`, {}, env);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("image/png");
    expect(new Uint8Array(await file.arrayBuffer()).slice(0, 8)).toEqual(TINY_PNG.slice(0, 8));

    const reset = await app.request(
      "https://studio.digisavvy.dev/api/branding",
      {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  ", clearLogo: true }),
      },
      env,
    );
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({
      name: "Oxen Studio",
      savedName: null,
      logoUrl: DEFAULT_LOGO_PATH,
      logoType: "image/svg+xml",
      customLogo: false,
    });
    const gone = await app.request("https://studio.digisavvy.dev/api/branding/logo", {}, env);
    expect(gone.status).toBe(404);
  });

  it("rejects branding changes from someone who is not an admin", async () => {
    const env = brandingEnv("");
    const res = await app.request(
      "https://studio.digisavvy.dev/api/branding",
      {
        method: "PUT",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "DS Studio" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const still = await app.request("https://studio.digisavvy.dev/api/branding", {}, env);
    expect(await still.json()).toMatchObject({ name: "Oxen Studio", customLogo: false });
  });
});
