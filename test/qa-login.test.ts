import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE, loadAuthorizedUser, userHasAccess } from "../worker/auth";
import {
  QA_GITHUB_ID,
  QA_LOGIN,
  QA_MAX_ATTEMPTS_PER_WINDOW,
  qaAttemptAllowed,
  qaLoginHash,
  qaSecretMatches,
} from "../worker/qa-login";
import { createEnv } from "./helpers";

const SECRET = "q".repeat(64);
const SECRET_SHA256 = "ee8e658590c9a5e119400a774415a01db104de1ee6e2c29ec69aa73ef46544d2";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Real SQLite + the real migrations, so the route's SQL runs as D1 runs it.
function sqliteD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  for (const file of [
    "0001_init.sql",
    "0011_allowlist_github_id.sql",
    "0012_session_github_token.sql",
    "0013_session_org_checked_at.sql",
    "0030_qa_login_attempts.sql",
  ]) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql: string) {
      const bound = (args: (string | number | null)[]) => {
        const stmt = raw.prepare(sql);
        return {
          async first() {
            return stmt.get(...args) ?? null;
          },
          async run() {
            stmt.run(...args);
            return { success: true };
          },
        };
      };
      return { ...bound([]), bind: (...args: (string | number | null)[]) => bound(args) };
    },
  } as unknown as D1Database;
  return { db, raw };
}

async function qaEnv(overrides: Record<string, unknown> = {}) {
  const { db, raw } = sqliteD1();
  const env = createEnv({ DB: db, QA_LOGIN_SHA256: await sha256Hex(SECRET), ...overrides });
  return { env, raw };
}

function signIn(env: ReturnType<typeof createEnv>, secret: unknown, headers: Record<string, string> = { "X-Studio-QA": "1" }) {
  return app.request(
    "https://studio.digisavvy.dev/api/auth/qa-login",
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ secret }) },
    env,
  );
}

function sessionIdFrom(res: Response): string | null {
  const match = (res.headers.get("Set-Cookie") ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

describe("QA sign-in", () => {
  // Self-hosters who never set the hash must not gain a second way in.
  it("does not exist when no hash is configured", async () => {
    const { env } = await qaEnv({ QA_LOGIN_SHA256: undefined });
    expect((await signIn(env, SECRET)).status).toBe(404);
  });

  it("stays off when the configured value is not a SHA-256", async () => {
    expect(qaLoginHash({ QA_LOGIN_SHA256: SECRET })).toBeNull();
    expect(qaLoginHash({ QA_LOGIN_SHA256: "" })).toBeNull();
    expect(qaLoginHash({ QA_LOGIN_SHA256: ` ${SECRET_SHA256.toUpperCase()} ` })).toBe(SECRET_SHA256);
  });

  it("signs in the QA user, and only the QA user, with the right secret", async () => {
    const { env, raw } = await qaEnv();
    const res = await signIn(env, SECRET);
    expect(res.status).toBe(200);
    const sessionId = sessionIdFrom(res);
    expect(sessionId).toBeTruthy();
    const users = raw.prepare("SELECT github_id, login FROM users").all();
    expect(users).toEqual([{ github_id: QA_GITHUB_ID, login: QA_LOGIN }]);
    const user = await loadAuthorizedUser(env, sessionId!);
    expect(user?.login).toBe(QA_LOGIN);
  });

  it("refuses a wrong, short, or missing secret", async () => {
    const { env, raw } = await qaEnv();
    for (const bad of ["w".repeat(64), "short", "", null, 42, undefined]) {
      const res = await signIn(env, bad);
      expect(res.status).toBe(401);
      expect(sessionIdFrom(res)).toBeNull();
    }
    expect(raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  // The hash is not a password: knowing what the Worker stores must not sign anyone in.
  it("refuses the stored hash presented as the secret", async () => {
    const { env } = await qaEnv();
    expect((await signIn(env, await sha256Hex(SECRET))).status).toBe(401);
    expect(await qaSecretMatches(SECRET, env)).toBe(true);
  });

  // A cross-site form can post JSON-looking text but cannot set a custom header.
  it("refuses a request without the QA header", async () => {
    const { env } = await qaEnv();
    expect((await signIn(env, SECRET, {})).status).toBe(403);
  });

  it("never makes the QA user an admin", async () => {
    const { env } = await qaEnv({ GITHUB_ADMINS: `${QA_LOGIN},-1,1` });
    const sessionId = sessionIdFrom(await signIn(env, SECRET))!;
    const me = await app.request(
      "https://studio.digisavvy.dev/api/auth/me",
      { headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` } },
      env,
    );
    const { user } = (await me.json()) as { user: { login: string; isAdmin: boolean } };
    expect(user.login).toBe(QA_LOGIN);
    expect(user.isAdmin).toBe(false);
  });

  // Deleting the hash is the off switch, and it has to reach sessions that already exist.
  it("ends live QA sessions as soon as the hash is removed", async () => {
    const { env, raw } = await qaEnv();
    const sessionId = sessionIdFrom(await signIn(env, SECRET))!;
    const off = { ...env, QA_LOGIN_SHA256: undefined };
    expect(await loadAuthorizedUser(off, sessionId)).toBeNull();
    expect(raw.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("gives the QA user access only while the hash is set, whatever the allowlist says", async () => {
    const { env, raw } = await qaEnv();
    raw.prepare(`INSERT INTO allowlist (github_login, github_id, added_by, created_at) VALUES (?, ?, 'admin', 0)`).run(QA_LOGIN, QA_GITHUB_ID);
    const qa = { id: QA_GITHUB_ID, login: QA_LOGIN };
    expect((await userHasAccess(env.DB, qa, "", env)).allowed).toBe(true);
    const off = await userHasAccess(env.DB, qa, "", { ...env, QA_LOGIN_SHA256: undefined });
    expect(off).toMatchObject({ allowed: false, revoke: true });
  });

  it("stops after ten attempts in a ten-minute window, right secret included", async () => {
    const { env } = await qaEnv();
    for (let i = 0; i < QA_MAX_ATTEMPTS_PER_WINDOW; i++) {
      expect((await signIn(env, "w".repeat(64))).status).toBe(401);
    }
    expect((await signIn(env, SECRET)).status).toBe(429);
  });

  it("counts attempts per window and forgets old windows", async () => {
    const { db, raw } = sqliteD1();
    const start = 1_800_000_000 - (1_800_000_000 % 600);
    for (let i = 0; i < QA_MAX_ATTEMPTS_PER_WINDOW; i++) expect(await qaAttemptAllowed(db, start + i)).toBe(true);
    expect(await qaAttemptAllowed(db, start + 599)).toBe(false);
    expect(await qaAttemptAllowed(db, start + 600)).toBe(true);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM qa_login_attempts").get()).toEqual({ n: 1 });
  });
});
