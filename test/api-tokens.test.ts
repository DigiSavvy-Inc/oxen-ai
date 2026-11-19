import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { TOKEN_SCOPE_DENIED, tokenMayCall } from "../worker/api-scope";
import {
  TOKEN_ACCESS_LOST,
  TOKEN_MAX_FAILURES_PER_WINDOW,
  TOKEN_MAX_LIVE,
  capExceededMessage,
  createToken,
  hashToken,
  reserveSpend,
  spentTodayCents,
  tokenRunCents,
  utcDay,
} from "../worker/api-tokens";
import { app } from "../worker/index";
import { resetModelDetailCache } from "../worker/oxen";
import type { Env } from "../worker/types";
import { createEnv, createMockR2, TEST_SECRET } from "./helpers";

const ORIGIN = "https://studio.digisavvy.dev";
const USER = "u1";
const GITHUB_ID = 4242;
const OTHER_USER = "u2";
const SESSION = "session-u1";
const OTHER_SESSION = "session-u2";
const PROFILE = "profile-1";
const OTHER_PROFILE = "profile-2";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  // A priced model stub from one case must not price the next case's model.
  resetModelDetailCache();
});

type Row = Record<string, unknown>;

/** A real SQLite database with every migration, or every one before API tokens. */
function openDb(options: { withoutTokens?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => !(options.withoutTokens && name >= "0033"))
    .sort();
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const now = Math.floor(Date.now() / 1000);
  const insertUser = raw.prepare(
    `INSERT INTO users (id, github_id, login, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`,
  );
  insertUser.run(USER, GITHUB_ID, "ada", "Ada");
  insertUser.run(OTHER_USER, 5151, "grace", "Grace");
  const insertSession = raw.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, created_at, org_checked_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insertSession.run(SESSION, USER, now + 3600, now, now);
  insertSession.run(OTHER_SESSION, OTHER_USER, now + 3600, now, now);
  const insertProfile = raw.prepare(
    `INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insertProfile.run(PROFILE, USER, "Personal", 1, 1);
  insertProfile.run(OTHER_PROFILE, USER, "Work", 100, 100);
  raw
    .prepare(
      `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, history_page_size, active_profile_id, updated_at)
       VALUES (?, '{}', '{}', 12, ?, 1)`,
    )
    .run(USER, PROFILE);
  type Args = (string | number | null)[];
  const statement = (sql: string, args: Args) => ({
    async first() {
      return (raw.prepare(sql).get(...args) as Row | undefined) ?? null;
    },
    async all() {
      return { results: raw.prepare(sql).all(...args) };
    },
    async run() {
      const info = raw.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  const db = {
    prepare(sql: string) {
      return { ...statement(sql, []), bind: (...args: Args) => statement(sql, args) };
    },
    async batch(statements: { run: () => Promise<unknown> }[]) {
      const out = [];
      for (const stmt of statements) out.push(await stmt.run());
      return out;
    },
  } as unknown as D1Database;
  return { db, raw };
}

/** USER is an admin by account id unless the test says otherwise. */
function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return createEnv({ DB: db, MEDIA: createMockR2().bucket, GITHUB_ADMINS: String(GITHUB_ID), ...overrides });
}

function call(
  env: Env,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    `${ORIGIN}${path}`,
    {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
}

const cookie = (session = SESSION) => ({ Cookie: `${SESSION_COOKIE}=${session}` });
const bearer = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  ...extra,
});

async function newToken(db: D1Database, cap = 5, userId = USER, name = "Agent"): Promise<string> {
  const made = await createToken(db, userId, { name, dailyCapUsd: cap });
  if ("error" in made) throw new Error(made.error);
  return made.token;
}

describe("token create, list, and revoke", () => {
  it("returns the token once and stores only its hash and prefix", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db);
    const res = await call(env, "/api/settings/tokens", {
      method: "POST",
      headers: cookie(),
      body: { name: "Render agent", dailyCapUsd: 5 },
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { token: string; item: { prefix: string; dailyCapUsd: number } };
    expect(created.token).toMatch(/^dss_[A-Za-z0-9_-]{43}$/);
    expect(created.item.prefix).toBe(created.token.slice(0, 8));
    expect(created.item.dailyCapUsd).toBe(5);

    const stored = raw.prepare(`SELECT * FROM api_tokens`).all() as Row[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).toBe(await hashToken(created.token));
    expect(stored[0]!.daily_cap_cents).toBe(500);
    // The secret part of the token is nowhere in the database.
    expect(JSON.stringify(stored)).not.toContain(created.token.slice(8));

    const list = await call(env, "/api/settings/tokens", { headers: cookie() });
    const listed = (await list.json()) as { tokens: { name: string; spentTodayUsd: number }[]; ready: boolean };
    expect(listed.ready).toBe(true);
    expect(listed.tokens.map((token) => token.name)).toEqual(["Render agent"]);
    expect(listed.tokens[0]!.spentTodayUsd).toBe(0);
    expect(JSON.stringify(listed)).not.toContain(created.token);
  });

  it("revokes a token so it stops working", async () => {
    const { db } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    expect((await call(env, "/api/auth/me", { headers: bearer(token) })).status).toBe(200);
    const { tokens } = (await (await call(env, "/api/settings/tokens", { headers: cookie() })).json()) as {
      tokens: { id: string }[];
    };
    const revoked = await call(env, `/api/settings/tokens/${tokens[0]!.id}`, { method: "DELETE", headers: cookie() });
    expect(revoked.status).toBe(200);
    expect((await call(env, "/api/auth/me", { headers: bearer(token) })).status).toBe(401);
    const after = (await (await call(env, "/api/settings/tokens", { headers: cookie() })).json()) as {
      tokens: unknown[];
    };
    expect(after.tokens).toEqual([]);
    // Someone else's token id is not found.
    const other = await call(env, `/api/settings/tokens/${tokens[0]!.id}`, {
      method: "DELETE",
      headers: cookie(OTHER_SESSION),
    });
    expect(other.status).toBe(404);
  });

  it("requires a name and a cap from $0.50 to $500, and allows ten live tokens", async () => {
    const { db } = openDb();
    const env = makeEnv(db);
    const post = (body: unknown) => call(env, "/api/settings/tokens", { method: "POST", headers: cookie(), body });
    expect((await post({ name: "No cap" })).status).toBe(400);
    expect((await post({ name: "Low", dailyCapUsd: 0.49 })).status).toBe(400);
    expect((await post({ name: "High", dailyCapUsd: 500.01 })).status).toBe(400);
    expect((await post({ name: "Text", dailyCapUsd: "5" })).status).toBe(400);
    expect((await post({ name: "  ", dailyCapUsd: 5 })).status).toBe(400);
    expect((await post({ name: "Min", dailyCapUsd: 0.5 })).status).toBe(200);
    for (let i = 1; i < TOKEN_MAX_LIVE; i += 1) {
      expect((await post({ name: `T${i}`, dailyCapUsd: 500 })).status).toBe(200);
    }
    const over = await post({ name: "Eleventh", dailyCapUsd: 5 });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toContain("Revoke one");
  });

  it("never passes ten live tokens when creates arrive at once", async () => {
    const { db, raw } = openDb();
    for (let i = 1; i < TOKEN_MAX_LIVE; i += 1) await newToken(db, 5, USER, `T${i}`);
    const results = await Promise.all(
      [1, 2, 3].map((n) => createToken(db, USER, { name: `Race ${n}`, dailyCapUsd: 5 })),
    );
    expect(results.filter((result) => "token" in result)).toHaveLength(1);
    expect(results.filter((result) => "error" in result && result.error === "limit")).toHaveLength(2);
    expect(
      raw.prepare(`SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL`).get(USER),
    ).toMatchObject({ n: TOKEN_MAX_LIVE });
  });

  it("is browser-only: a token can never list, create, or revoke tokens", async () => {
    const { db } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    for (const [method, path] of [
      ["GET", "/api/settings/tokens"],
      ["POST", "/api/settings/tokens"],
      ["DELETE", "/api/settings/tokens/anything"],
    ] as const) {
      const res = await call(env, path, {
        method,
        headers: bearer(token),
        body: method === "POST" ? { name: "Child", dailyCapUsd: 5 } : undefined,
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe(TOKEN_SCOPE_DENIED);
    }
  });
});

describe("signing in with a token", () => {
  it("signs in and adds the token's cap and spend to /api/auth/me, never the Oxen key", async () => {
    const { db, raw } = openDb();
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    raw.prepare(`UPDATE users SET oxen_key_ciphertext = ?, oxen_key_iv = ? WHERE id = ?`).run(ciphertext, iv, USER);
    const env = makeEnv(db);
    const token = await newToken(db, 7.5);
    const res = await call(env, "/api/auth/me", { headers: bearer(token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string; hasOxenKey: boolean }; token: unknown };
    expect(body.user.id).toBe(USER);
    expect(body.user.hasOxenKey).toBe(true);
    expect(body.token).toEqual({ name: "Agent", dailyCapUsd: 7.5, spentTodayUsd: 0 });
    const text = JSON.stringify(body);
    expect(text).not.toContain("sk-user");
    expect(text).not.toContain(ciphertext);
    expect(raw.prepare(`SELECT last_used_at FROM api_tokens`).get()).toMatchObject({
      last_used_at: expect.any(Number),
    });
  });

  it("refuses unknown, malformed, and revoked tokens", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    for (const presented of [`dss_${"A".repeat(43)}`, "not-a-token", "", token.slice(0, -1)]) {
      expect((await call(env, "/api/generations?scope=active", { headers: bearer(presented) })).status).toBe(401);
    }
    raw.prepare(`UPDATE api_tokens SET revoked_at = 1`).run();
    expect((await call(env, "/api/generations?scope=active", { headers: bearer(token) })).status).toBe(401);
  });

  it("limits failed attempts per address", async () => {
    const { db } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    const from = (ip: string, presented: string) =>
      call(env, "/api/auth/me", { headers: bearer(presented, { "CF-Connecting-IP": ip }) });
    for (let i = 0; i < TOKEN_MAX_FAILURES_PER_WINDOW; i += 1) {
      expect((await from("203.0.113.9", `dss_${"B".repeat(43)}`)).status).toBe(401);
    }
    expect((await from("203.0.113.9", `dss_${"B".repeat(43)}`)).status).toBe(429);
    // Even the right token waits out the window from that address; other addresses are fine.
    expect((await from("203.0.113.9", token)).status).toBe(429);
    expect((await from("198.51.100.4", token)).status).toBe(200);
  });

  it("lets the cookie win when a request carries both", async () => {
    const { db } = openDb();
    const env = makeEnv(db, { GITHUB_ADMINS: `${GITHUB_ID},5151` });
    const otherToken = await newToken(db, 5, OTHER_USER);
    const res = await call(env, "/api/auth/me", { headers: { ...cookie(), ...bearer(otherToken) } });
    const body = (await res.json()) as { user: { id: string }; token?: unknown };
    expect(body.user.id).toBe(USER);
    expect(body.token).toBeUndefined();
    // A token never widens a cookie request, and a dead cookie is not rescued by a token.
    const settings = await call(env, "/api/settings/studio", { headers: { ...cookie(), ...bearer(otherToken) } });
    expect(settings.status).toBe(200);
    const dead = await call(env, "/api/generations?scope=active", {
      headers: { ...cookie("no-such-session"), ...bearer(otherToken) },
    });
    expect(dead.status).toBe(401);
  });
});

describe("who a token may act for", () => {
  const me = (env: Env, token: string) => call(env, "/api/auth/me", { headers: bearer(token) });

  it("passes an admin and an allowlisted user on the D1 checks alone", async () => {
    const { db, raw } = openDb();
    raw.prepare(`DELETE FROM sessions`).run();
    const token = await newToken(db);
    expect((await me(makeEnv(db, { GITHUB_ADMINS: String(GITHUB_ID) }), token)).status).toBe(200);
    raw.prepare(`INSERT INTO allowlist (github_login, created_at) VALUES ('ada', 1)`).run();
    expect((await me(makeEnv(db, { GITHUB_ADMINS: "" }), token)).status).toBe(200);
  });

  it("passes an org member only while they have a live browser session", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db, { GITHUB_ADMINS: "", GITHUB_ORG: "DigiSavvy-Inc" });
    const token = await newToken(db);
    // The session's org check is fresh, so no GitHub call is needed.
    expect((await me(env, token)).status).toBe(200);

    raw.prepare(`UPDATE sessions SET expires_at = 1 WHERE user_id = ?`).run(USER);
    const expired = await me(env, token);
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { error: string }).error).toBe(TOKEN_ACCESS_LOST);

    raw.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(USER);
    expect((await me(env, token)).status).toBe(401);
  });

  it("refuses an org member whose session can no longer prove membership", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db, { GITHUB_ADMINS: "", GITHUB_ORG: "DigiSavvy-Inc" });
    const token = await newToken(db);
    // A stale org check with no GitHub token: the session check ends that session.
    raw.prepare(`UPDATE sessions SET org_checked_at = 1 WHERE user_id = ?`).run(USER);
    expect((await me(env, token)).status).toBe(401);
    expect(raw.prepare(`SELECT id FROM sessions WHERE user_id = ?`).all(USER)).toEqual([]);
  });

  it("refuses everyone but admins and the allowlist when no org is set", async () => {
    const { db } = openDb();
    const token = await newToken(db);
    expect((await me(makeEnv(db, { GITHUB_ADMINS: "", GITHUB_ORG: "" }), token)).status).toBe(401);
  });
});

describe("token scope", () => {
  // The issue's allowlist, written out route by route. A new route is not here, so it must be closed.
  const ALLOWED = new Set([
    "GET /api/health",
    "GET /api/auth/me",
    "GET /api/models",
    "GET /api/models/favorites",
    "GET /api/models/search",
    "GET /api/models/references",
    "GET /api/models/:id",
    "GET /api/billing/credits",
    "POST /api/upload",
    "POST /api/media/renew",
    "GET /api/media/*",
    "POST /api/generate",
    "GET /api/generations",
    "GET /api/generations/:id",
    "POST /api/generations/:id/last-frame",
    "PUT /api/generations/:id/tags",
    "GET /api/profiles",
    "GET /api/galleries",
    "GET /api/galleries/:id",
    "POST /api/galleries",
    "PUT /api/galleries/:id/collection",
    "GET /api/collections",
    "GET /api/collections/:id/assets",
    "POST /api/collections",
    "GET /api/slots",
    "POST /api/slots",
    "POST /api/slots/:id/files",
    "GET /api/projects",
    "GET /api/projects/:id",
    "GET /api/projects/:id/jobs",
    "GET /api/prompts",
    "GET /api/oxen/queue",
  ]);
  const routes = app.routes
    .filter((route) => route.method !== "ALL" && route.path.startsWith("/api/"))
    .map((route) => `${route.method} ${route.path}`);

  it("opens exactly the listed routes and closes every other one", () => {
    expect(routes.length).toBeGreaterThan(ALLOWED.size);
    for (const route of routes) {
      const [method, path] = route.split(" ") as [string, string];
      expect({ route, open: tokenMayCall(method, path) }).toEqual({ route, open: ALLOWED.has(route) });
    }
    // Every listed route still exists, so the table cannot drift from the app.
    for (const route of ALLOWED) expect(routes).toContain(route);
  });

  it("never opens a delete, settings, admin, branding write, profile change, share, push, or chat", () => {
    for (const route of routes) {
      const [method, path] = route.split(" ") as [string, string];
      const forbidden =
        method === "DELETE" ||
        path.startsWith("/api/settings") ||
        path.startsWith("/api/admin") ||
        (path.startsWith("/api/branding") && method !== "GET") ||
        (path.startsWith("/api/auth/") && path !== "/api/auth/me") ||
        (path.startsWith("/api/profiles") && method !== "GET") ||
        path.includes("/shares") ||
        path.startsWith("/api/push") ||
        path === "/api/chat" ||
        path === "/api/library/cleanup" ||
        path === "/api/generations/delete" ||
        path === "/api/galleries/files/delete";
      if (forbidden) expect({ route, open: tokenMayCall(method, path) }).toEqual({ route, open: false });
    }
  });

  it("answers 403 before the route runs", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    raw
      .prepare(`INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id) VALUES ('g1', ?, 'Keep', 1, 1, ?)`)
      .run(USER, PROFILE);
    for (const [method, path] of [
      ["DELETE", "/api/galleries/g1"],
      ["POST", "/api/profiles"],
      ["POST", "/api/profiles/profile-2/activate"],
      ["PUT", "/api/settings/studio"],
      ["POST", "/api/library/cleanup"],
      ["GET", "/api/admin/allowlist"],
    ] as const) {
      const res = await call(env, path, { method, headers: bearer(token), body: method === "GET" ? undefined : {} });
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(raw.prepare(`SELECT id FROM galleries`).all()).toHaveLength(1);
    expect(raw.prepare(`SELECT active_profile_id FROM user_settings`).get()).toMatchObject({
      active_profile_id: PROFILE,
    });
  });
});

describe("X-Studio-Profile", () => {
  it("uses the named profile for that request only, and never changes the active one", async () => {
    const { db, raw } = openDb();
    const env = makeEnv(db);
    const token = await newToken(db);
    const made = await call(env, "/api/collections", {
      method: "POST",
      headers: bearer(token, { "X-Studio-Profile": OTHER_PROFILE }),
      body: { name: "Work set" },
    });
    expect(made.status).toBe(200);
    expect(raw.prepare(`SELECT profile_id FROM collections`).get()).toMatchObject({ profile_id: OTHER_PROFILE });
    expect(raw.prepare(`SELECT active_profile_id FROM user_settings`).get()).toMatchObject({
      active_profile_id: PROFILE,
    });
    const listed = async (headers: Record<string, string>) =>
      ((await (await call(env, "/api/collections", { headers })).json()) as { collections: unknown[] }).collections;
    expect(await listed(bearer(token, { "X-Studio-Profile": OTHER_PROFILE }))).toHaveLength(1);
    expect(await listed(bearer(token))).toHaveLength(0);
    // Cookie requests are unchanged: the header is ignored.
    expect(await listed({ ...cookie(), "X-Studio-Profile": OTHER_PROFILE })).toHaveLength(0);
  });

  it("answers 400 for a profile that is not the owner's", async () => {
    const { db, raw } = openDb();
    raw
      .prepare(`INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES ('theirs', ?, 'X', 1, 1)`)
      .run(OTHER_USER);
    const env = makeEnv(db);
    const token = await newToken(db);
    for (const id of ["missing", "theirs"]) {
      const res = await call(env, "/api/collections", { headers: bearer(token, { "X-Studio-Profile": id }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("Profile not found");
    }
  });
});

describe("X-Studio-Profile on routes that take an id", () => {
  async function seeded() {
    const { db, raw } = openDb();
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    raw.prepare(`UPDATE users SET oxen_key_ciphertext = ?, oxen_key_iv = ? WHERE id = ?`).run(ciphertext, iv, USER);
    raw
      .prepare(`INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id) VALUES (?, ?, ?, 1, 1, ?)`)
      .run("g-personal", USER, "Personal set", PROFILE);
    raw
      .prepare(`INSERT INTO projects (id, user_id, profile_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`)
      .run("p-personal", USER, PROFILE, "Personal project");
    raw
      .prepare(
        `INSERT INTO generations
           (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, params_json, created_at, updated_at, profile_id)
         VALUES (?, ?, 'ox-1', 'text-to-image', 'img-model', 'a cube', 'failed', 'image', '{}', 1, 1, ?)`,
      )
      .run("gen-personal", USER, PROFILE);
    return { db, raw, env: makeEnv(db), token: await newToken(db) };
  }

  const requests: [string, string, unknown?][] = [
    ["GET", "/api/galleries/g-personal"],
    ["POST", "/api/galleries", { id: "g-personal", name: "Renamed", items: [] }],
    ["GET", "/api/projects/p-personal"],
    ["GET", "/api/projects/p-personal/jobs"],
    ["GET", "/api/generations/gen-personal"],
    ["PUT", "/api/generations/gen-personal/tags", { tags: ["moved"] }],
    ["POST", "/api/generations/gen-personal/last-frame"],
  ];

  it("cannot read or change another profile's gallery, project, or generation", async () => {
    const { raw, env, token } = await seeded();
    for (const [method, path, body] of requests) {
      const res = await call(env, path, {
        method,
        headers: bearer(token, { "X-Studio-Profile": OTHER_PROFILE }),
        body,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(raw.prepare(`SELECT name FROM galleries WHERE id = 'g-personal'`).get()).toMatchObject({
      name: "Personal set",
    });
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM generation_tags`).get()).toMatchObject({ n: 0 });
  });

  it("without the header, is held to the active profile and cannot reach another one by id", async () => {
    const { raw, env, token } = await seeded();
    // The browser switches the account to the other profile. The rows stay on the first one.
    const switched = await call(env, `/api/profiles/${OTHER_PROFILE}/activate`, { method: "POST", headers: cookie() });
    expect(switched.status).toBe(200);
    for (const [method, path, body] of requests) {
      const res = await call(env, path, { method, headers: bearer(token), body });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(raw.prepare(`SELECT name FROM galleries WHERE id = 'g-personal'`).get()).toMatchObject({
      name: "Personal set",
    });
    // The browser session itself still reaches them, as before.
    expect((await call(env, "/api/galleries/g-personal", { headers: cookie() })).status).toBe(200);
  });

  it("reaches the same rows when the header names their profile, and when that profile is active", async () => {
    const { env, token } = await seeded();
    for (const headers of [bearer(token, { "X-Studio-Profile": PROFILE }), bearer(token), cookie()]) {
      expect((await call(env, "/api/galleries/g-personal", { headers })).status).toBe(200);
      expect((await call(env, "/api/projects/p-personal", { headers })).status).toBe(200);
      expect((await call(env, "/api/projects/p-personal/jobs", { headers })).status).toBe(200);
      const tagged = await call(env, "/api/generations/gen-personal/tags", {
        method: "PUT",
        headers,
        body: { tags: ["kept"] },
      });
      expect(tagged.status).toBe(200);
    }
  });
});

describe("daily cap", () => {
  const tokenRef = (id: string, capCents: number) => ({ id, name: "Agent", dailyCapCents: capCents });

  it("adds runs only while the day's total stays within the cap", async () => {
    const { db } = openDb();
    const token = tokenRef("t1", 100);
    expect(await reserveSpend(db, token, 60)).toBe(true);
    expect(await reserveSpend(db, token, 30)).toBe(true);
    expect(await reserveSpend(db, token, 20)).toBe(false);
    expect(await reserveSpend(db, token, 10)).toBe(true);
    expect(await reserveSpend(db, token, 0.3)).toBe(false);
    expect(await spentTodayCents(db, token.id)).toBe(100);
    // A new UTC day starts from zero.
    expect(await reserveSpend(db, token, 100, "2099-01-01")).toBe(true);
    // A single run larger than the cap never lands.
    expect(await reserveSpend(db, tokenRef("t2", 100), 101)).toBe(false);
  });

  it("lets only one of two runs at once through when both would not fit", async () => {
    const { db } = openDb();
    const token = tokenRef("t1", 100);
    const results = await Promise.all([reserveSpend(db, token, 60), reserveSpend(db, token, 60)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await spentTodayCents(db, token.id)).toBe(60);
  });

  it("uses the UTC day and says the cap and spend in dollars", () => {
    expect(utcDay(Date.UTC(2026, 10, 19, 23, 59))).toBe("2026-11-19");
    expect(utcDay(Date.UTC(2026, 10, 20, 0, 0))).toBe("2026-11-20");
    expect(capExceededMessage(500, 487)).toBe("This token's daily limit of $5.00 is used up ($4.87 spent today).");
  });

  async function generateEnv(pricing: Record<string, unknown> | null) {
    const { db, raw } = openDb();
    const { ciphertext, iv } = await encryptSecret("sk-user", TEST_SECRET);
    raw.prepare(`UPDATE users SET oxen_key_ciphertext = ?, oxen_key_iv = ? WHERE id = ?`).run(ciphertext, iv, USER);
    const queued: Record<string, unknown>[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://hub.oxen.ai/api/ai/models/img-model") {
        return Response.json({
          id: "img-model",
          request_schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" } } },
          ...(pricing ? { pricing } : {}),
        });
      }
      if (url === "https://hub.oxen.ai/api/ai/queue" && init?.method === "POST") {
        queued.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ generations: [{ generation_id: `gen-${queued.length}`, status: "queued" }] });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    return { db, raw, env: makeEnv(db), queued };
  }

  const run = (env: Env, headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
    call(env, "/api/generate", {
      method: "POST",
      headers,
      body: { mode: "text-to-image", model: "img-model", prompt: "a red cube", num_generations: 4, ...extra },
    });

  it("prices a token run on the server, ignores the client's estimate, and stops at the cap", async () => {
    const { db, env, queued } = await generateEnv({ method: "per_image", cost_per_image: 0.25 });
    const token = await newToken(db, 2);
    // 4 × $0.25 = $1.00 each run, whatever the client claims.
    const first = await run(env, bearer(token), { estimated_cost: 0.0001 });
    expect(first.status).toBe(200);
    expect((await run(env, bearer(token))).status).toBe(200);
    const third = await run(env, bearer(token), { estimated_cost: 0 });
    expect(third.status).toBe(402);
    expect(((await third.json()) as { error: string }).error).toBe(
      "This token's daily limit of $2.00 is used up ($2.00 spent today).",
    );
    expect(queued).toHaveLength(2);
    // The browser has no cap.
    expect((await run(env, cookie())).status).toBe(200);
    expect(queued).toHaveLength(3);
  });

  it("files a token run under the requested profile", async () => {
    const { db, raw, env } = await generateEnv({ method: "per_image", cost_per_image: 0.01 });
    const token = await newToken(db);
    const res = await run(env, bearer(token, { "X-Studio-Profile": OTHER_PROFILE }), { num_generations: 1 });
    expect(res.status).toBe(200);
    expect(raw.prepare(`SELECT profile_id FROM generations`).all()).toEqual([
      expect.objectContaining({ profile_id: OTHER_PROFILE }),
    ]);
  });

  it("will not run a project from another profile than the one the token named", async () => {
    const { db, raw, env, queued } = await generateEnv({ method: "per_image", cost_per_image: 0.01 });
    raw
      .prepare(`INSERT INTO projects (id, user_id, profile_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)`)
      .run("p-personal", USER, PROFILE, "Personal project");
    const token = await newToken(db);
    const res = await run(env, bearer(token, { "X-Studio-Profile": OTHER_PROFILE }), {
      num_generations: 1,
      project_id: "p-personal",
    });
    expect(res.status).toBe(404);
    expect(queued).toHaveLength(0);
    expect(raw.prepare(`SELECT * FROM api_token_spend`).all()).toEqual([]);
  });

  it("treats no price, zero, negative, NaN, and infinite as unpriced", () => {
    for (const amount of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.000001]) {
      expect(tokenRunCents(amount), String(amount)).toBeNull();
    }
    expect(tokenRunCents(0.25)).toBe(25);
    expect(tokenRunCents(0.004)).toBe(0.4);
  });

  it("refuses a model Studio cannot price, and queues nothing", async () => {
    const { db, raw, env, queued } = await generateEnv(null);
    const token = await newToken(db);
    const res = await run(env, bearer(token));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Studio cannot price this model, so a token cannot run it.",
    );
    expect(queued).toHaveLength(0);
    expect(raw.prepare(`SELECT * FROM api_token_spend`).all()).toEqual([]);
  });
});

describe("before the migration", () => {
  it("lists no tokens, refuses to make one, and refuses every bearer", async () => {
    const { db } = openDb({ withoutTokens: true });
    const env = makeEnv(db);
    const list = await call(env, "/api/settings/tokens", { headers: cookie() });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ tokens: [], ready: false });
    const create = await call(env, "/api/settings/tokens", {
      method: "POST",
      headers: cookie(),
      body: { name: "Early", dailyCapUsd: 5 },
    });
    expect(create.status).toBe(400);
    expect((await call(env, "/api/auth/me", { headers: bearer(`dss_${"C".repeat(43)}`) })).status).toBe(401);
    // Cookie requests carry on as before.
    expect((await call(env, "/api/collections", { headers: cookie() })).status).toBe(200);
  });
});
