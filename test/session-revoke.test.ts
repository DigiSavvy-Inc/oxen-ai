import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../worker/index";
import { ORG_RECHECK_SECONDS, SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import type { Env, UserRow } from "../worker/types";
import { TEST_SECRET, createEnv } from "./helpers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function person(partial: Partial<UserRow> & Pick<UserRow, "id" | "login" | "github_id">): UserRow {
  return {
    name: partial.login,
    avatar_url: null,
    oxen_key_ciphertext: null,
    oxen_key_iv: null,
    created_at: 1,
    updated_at: 1,
    ...partial,
  };
}

type AllowRow = { login: string; githubId: number | null };
type StoredSession = {
  user: UserRow;
  token: { ciphertext: string; iv: string } | null;
  orgCheckedAt?: number | null;
};

function accessDb(state: { sessions: Map<string, StoredSession>; allow: AllowRow[] }): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM sessions")) {
                const session = state.sessions.get(String(args[0]));
                if (!session) return null;
                return {
                  ...session.user,
                  github_token_ciphertext: session.token?.ciphertext ?? null,
                  github_token_iv: session.token?.iv ?? null,
                  org_checked_at: session.orgCheckedAt ?? null,
                };
              }
              if (sql.includes("SELECT github_id FROM allowlist")) {
                const login = String(args[0]).toLowerCase();
                const row = state.allow.find((item) => item.login === login);
                return row ? { github_id: row.githubId } : null;
              }
              if (sql.includes("FROM allowlist")) {
                const githubId = Number(args[0]);
                const login = String(args[1] ?? "").toLowerCase();
                const row = state.allow.find(
                  (item) => item.githubId === githubId || (item.githubId == null && item.login === login),
                );
                return row ? { github_login: row.login, github_id: row.githubId } : null;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              if (sql.includes("UPDATE sessions SET org_checked_at")) {
                const session = state.sessions.get(String(args[1]));
                if (session) session.orgCheckedAt = Number(args[0]);
              }
              if (sql.includes("DELETE FROM allowlist")) {
                const login = String(args[0]).toLowerCase();
                state.allow = state.allow.filter((item) => item.login !== login);
              }
              if (sql.includes("DELETE FROM sessions") && sql.includes("user_id IN")) {
                const login = String(args[0]).toLowerCase();
                const githubId = args[1] == null ? null : Number(args[1]);
                for (const [id, session] of state.sessions) {
                  const sameLogin = session.user.login.toLowerCase() === login;
                  const sameId = githubId != null && session.user.github_id === githubId;
                  if (sameLogin || sameId) state.sessions.delete(id);
                }
              } else if (sql.includes("DELETE FROM sessions")) {
                state.sessions.delete(String(args[0]));
              }
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function settings(env: Env, sessionId: string) {
  return app.request(
    "https://studio.digisavvy.dev/api/settings/oxen-key",
    { headers: { Cookie: `${SESSION_COOKIE}=${sessionId}` } },
    env,
  );
}

function mockOrgMembership() {
  let open = true;
  let status: number | null = null;
  let calls = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/user/memberships/orgs/")) return originalFetch(input, init);
    calls += 1;
    if (status !== null) return new Response("", { status });
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    if (authorization !== "Bearer studio-test-token") return new Response("", { status: 401 });
    if (!open) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ state: "active" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    close() {
      open = false;
    },
    open() {
      open = true;
    },
    respondWith(next: number | null) {
      status = next;
    },
    get calls() {
      return calls;
    },
  };
}

function advance(seconds: number) {
  vi.setSystemTime(Date.now() + seconds * 1000);
}

describe("session access is checked on each request", () => {
  it("keeps the bootstrap admin when the org is unset", async () => {
    const admin = person({ id: "admin", login: "renamed", github_id: 984399 });
    const state = {
      sessions: new Map<string, StoredSession>([["admin-session", { user: admin, token: null }]]),
      allow: [] as AllowRow[],
    };
    const env = createEnv({
      DB: accessDb(state),
      GITHUB_ORG: "",
      GITHUB_ADMINS: "984399",
    });
    expect((await settings(env, "admin-session")).status).toBe(200);
    expect((await settings({ ...env, GITHUB_ADMINS: "" }, "admin-session")).status).toBe(401);
  });

  it("rejects a removed allowlist user on the next request", async () => {
    const guest = person({ id: "guest", login: "guest", github_id: 9 });
    const state = {
      sessions: new Map<string, StoredSession>([["guest-session", { user: guest, token: null }]]),
      allow: [{ login: "guest", githubId: 9 }],
    };
    const env = createEnv({
      DB: accessDb(state),
      GITHUB_ORG: "",
      GITHUB_ADMINS: "984399",
    });
    expect((await settings(env, "guest-session")).status).toBe(200);
    state.allow = [];
    expect((await settings(env, "guest-session")).status).toBe(401);
    state.allow = [{ login: "guest", githubId: 9 }];
    expect((await settings(env, "guest-session")).status).toBe(401);
  });

  it("rejects an org member once GitHub reports they are gone", async () => {
    const guest = person({ id: "guest", login: "guest", github_id: 9 });
    const token = await encryptSecret("studio-test-token", TEST_SECRET);
    const state = {
      sessions: new Map<string, StoredSession>([["guest-session", { user: guest, token }]]),
      allow: [] as AllowRow[],
    };
    const org = mockOrgMembership();
    const env = createEnv({
      DB: accessDb(state),
      GITHUB_ORG: "DigiSavvy-Inc",
      GITHUB_ADMINS: "984399",
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    expect((await settings(env, "guest-session")).status).toBe(200);
    org.close();
    // Leaving the org ends the session at the next GitHub re-check, within 15 minutes.
    expect((await settings(env, "guest-session")).status).toBe(200);
    advance(ORG_RECHECK_SECONDS + 1);
    expect((await settings(env, "guest-session")).status).toBe(401);
    org.open();
    expect((await settings(env, "guest-session")).status).toBe(401);
  });

  // The app polls constantly; a GitHub call per request would burn the user's rate limit.
  it("asks GitHub about org membership at most once per re-check window", async () => {
    const guest = person({ id: "guest", login: "guest", github_id: 9 });
    const token = await encryptSecret("studio-test-token", TEST_SECRET);
    const state = {
      sessions: new Map<string, StoredSession>([["guest-session", { user: guest, token }]]),
      allow: [] as AllowRow[],
    };
    const org = mockOrgMembership();
    const env = createEnv({ DB: accessDb(state), GITHUB_ORG: "DigiSavvy-Inc", GITHUB_ADMINS: "984399" });
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 5; i++) expect((await settings(env, "guest-session")).status).toBe(200);
    expect(org.calls).toBe(1);
    advance(ORG_RECHECK_SECONDS + 1);
    expect((await settings(env, "guest-session")).status).toBe(200);
    expect(org.calls).toBe(2);
  });

  // GitHub rate limits answer 403; that is "can't tell", not "removed from the org".
  it("keeps an org member signed in when GitHub rate-limits the check", async () => {
    const guest = person({ id: "guest", login: "guest", github_id: 9 });
    const token = await encryptSecret("studio-test-token", TEST_SECRET);
    const state = {
      sessions: new Map<string, StoredSession>([["guest-session", { user: guest, token }]]),
      allow: [] as AllowRow[],
    };
    const org = mockOrgMembership();
    org.respondWith(403);
    const env = createEnv({ DB: accessDb(state), GITHUB_ORG: "DigiSavvy-Inc", GITHUB_ADMINS: "984399" });
    expect((await settings(env, "guest-session")).status).toBe(200);
    expect(state.sessions.has("guest-session")).toBe(true);
    org.respondWith(401);
    expect((await settings(env, "guest-session")).status).toBe(401);
  });

  it("drops sessions when an admin removes someone from the allowlist", async () => {
    const guest = person({ id: "guest", login: "guest", github_id: 9 });
    const admin = person({ id: "admin", login: "digisavvy", github_id: 984399 });
    const token = await encryptSecret("studio-test-token", TEST_SECRET);
    const state = {
      sessions: new Map<string, StoredSession>([
        ["guest-session", { user: guest, token }],
        ["admin-session", { user: admin, token: null }],
      ]),
      allow: [{ login: "guest", githubId: 9 }],
    };
    mockOrgMembership();
    const env = createEnv({
      DB: accessDb(state),
      GITHUB_ORG: "DigiSavvy-Inc",
      GITHUB_ADMINS: "984399",
    });
    expect((await settings(env, "guest-session")).status).toBe(200);
    const removed = await app.request(
      "https://studio.digisavvy.dev/api/admin/allowlist/guest",
      { method: "DELETE", headers: { Cookie: `${SESSION_COOKIE}=admin-session` } },
      env,
    );
    expect(removed.status).toBe(200);
    expect(state.sessions.has("guest-session")).toBe(false);
    expect((await settings(env, "guest-session")).status).toBe(401);
    expect((await settings(env, "admin-session")).status).toBe(200);
  });
});
