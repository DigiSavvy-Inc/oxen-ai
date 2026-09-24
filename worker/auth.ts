import { decryptSecret, encryptSecret } from "./crypto";
import type { Env, SessionUser, UserRow } from "./types";

const SESSION_COOKIE = "oxen_session";

const PLACEHOLDER_OAUTH_VALUES = new Set([
  "replace-me",
  "placeholder",
  "changeme",
  "change-me",
  "your-client-id",
  "your_client_id",
  "client_id",
  "example",
  "xxx",
  "xxxx",
]);

function isUnsetOrPlaceholder(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_OAUTH_VALUES.has(lower)) return true;
  if (lower.includes("placeholder") || lower.includes("replace-me") || lower.includes("changeme")) {
    return true;
  }
  return false;
}

/** True only when a real GitHub OAuth app is configured. Placeholders must not redirect to /login/oauth/authorize. */
export function oauthConfigured(env: Env): boolean {
  return !isUnsetOrPlaceholder(env.GITHUB_CLIENT_ID) && !isUnsetOrPlaceholder(env.GITHUB_CLIENT_SECRET);
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseAdmins(env: Env): Set<string> {
  return new Set(
    (env.GITHUB_ADMINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminLogin(login: string, env: Env): boolean {
  return parseAdmins(env).has(login.toLowerCase());
}

export function sessionCookieOptions(maxAge: number, secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  };
}

export function getSessionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export { SESSION_COOKIE };

export async function upsertUser(
  db: D1Database,
  profile: {
    githubId: number;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  },
): Promise<UserRow> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare("SELECT * FROM users WHERE github_id = ?")
    .bind(profile.githubId)
    .first<UserRow>();

  if (existing) {
    await db
      .prepare(
        `UPDATE users SET login = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(profile.login, profile.name, profile.avatarUrl, now, existing.id)
      .run();
    return {
      ...existing,
      login: profile.login,
      name: profile.name,
      avatar_url: profile.avatarUrl,
      updated_at: now,
    };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, profile.githubId, profile.login, profile.name, profile.avatarUrl, now, now)
    .run();

  return {
    id,
    github_id: profile.githubId,
    login: profile.login,
    name: profile.name,
    avatar_url: profile.avatarUrl,
    oxen_key_ciphertext: null,
    oxen_key_iv: null,
    created_at: now,
    updated_at: now,
  };
}

export async function createSession(
  db: D1Database,
  userId: string,
  ttlSeconds: number,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, userId, now + ttlSeconds, now)
    .run();
  return id;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function getUserBySession(
  db: D1Database,
  sessionId: string,
): Promise<UserRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sessionId, now)
    .first<UserRow>();
  return row ?? null;
}

export function toSessionUser(user: UserRow, env: Env): SessionUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    isAdmin: isAdminLogin(user.login, env),
    hasOxenKey: Boolean(user.oxen_key_ciphertext && user.oxen_key_iv),
  };
}

export async function userHasAccess(
  db: D1Database,
  login: string,
  accessToken: string,
  env: Env,
): Promise<{ allowed: boolean; reason?: string }> {
  if (isAdminLogin(login, env)) {
    return { allowed: true };
  }

  const allowlisted = await db
    .prepare("SELECT 1 AS ok FROM allowlist WHERE github_login = ? COLLATE NOCASE")
    .bind(login)
    .first<{ ok: number }>();
  if (allowlisted) {
    return { allowed: true };
  }

  const org = env.GITHUB_ORG?.trim();
  if (!org) {
    return { allowed: false, reason: "Not on the allowlist" };
  }
  const membership = await fetch(
    `https://api.github.com/user/memberships/orgs/${encodeURIComponent(org)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "oxen-studio",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (membership.status === 200) {
    const body = (await membership.json()) as { state?: string };
    if (body.state === "active") {
      return { allowed: true };
    }
  }

  if (membership.status === 404) {
    return {
      allowed: false,
      reason: `Not a member of ${org} and not on the allowlist`,
    };
  }

  return {
    allowed: false,
    reason: `Unable to verify ${org} membership`,
  };
}

export async function saveOxenKey(
  db: D1Database,
  userId: string,
  apiKey: string,
  encryptionKey: string,
): Promise<void> {
  const { ciphertext, iv } = await encryptSecret(apiKey, encryptionKey);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE users SET oxen_key_ciphertext = ?, oxen_key_iv = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(ciphertext, iv, now, userId)
    .run();
}

export async function clearOxenKey(db: D1Database, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE users SET oxen_key_ciphertext = NULL, oxen_key_iv = NULL, updated_at = ? WHERE id = ?`,
    )
    .bind(now, userId)
    .run();
}

export async function getOxenKey(
  user: UserRow,
  encryptionKey: string,
): Promise<string | null> {
  if (!user.oxen_key_ciphertext || !user.oxen_key_iv) return null;
  return decryptSecret(user.oxen_key_ciphertext, user.oxen_key_iv, encryptionKey);
}

export async function exchangeGithubCode(
  code: string,
  env: Env,
  redirectUri: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "GitHub token exchange failed");
  }
  return data.access_token;
}

export async function fetchGithubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "oxen-studio",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed (${res.status})`);
  }
  return (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
}
