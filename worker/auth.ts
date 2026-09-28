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

/**
 * Numeric GITHUB_ADMINS entries match the immutable GitHub account id; anything else
 * matches the login. Prefer ids — a renamed or deleted login can be claimed by someone else.
 */
export function isAdminUser(user: { githubId: number; login: string }, env: Env): boolean {
  const login = user.login.toLowerCase();
  for (const entry of parseAdmins(env)) {
    if (isNumericAdminEntry(entry) ? entry === String(user.githubId) : entry === login) return true;
  }
  return false;
}

export function isNumericAdminEntry(entry: string): boolean {
  return /^\d+$/.test(entry);
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

export type SealedGithubToken = { ciphertext: string; iv: string };

type SessionRecord = UserRow & {
  github_token_ciphertext?: string | null;
  github_token_iv?: string | null;
};

export async function sealGithubToken(
  token: string,
  encryptionKey: string,
): Promise<SealedGithubToken | null> {
  const trimmed = token.trim();
  if (!trimmed || !encryptionKey.trim()) return null;
  return encryptSecret(trimmed, encryptionKey);
}

export async function createSession(
  db: D1Database,
  userId: string,
  ttlSeconds: number,
  githubToken?: SealedGithubToken | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  try {
    await db
      .prepare(
        `INSERT INTO sessions
          (id, user_id, expires_at, created_at, github_token_ciphertext, github_token_iv)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        expiresAt,
        now,
        githubToken?.ciphertext ?? null,
        githubToken?.iv ?? null,
      )
      .run();
  } catch {
    await db
      .prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(id, userId, expiresAt, now)
      .run();
  }
  return id;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

/** End every session for this allowlist login, including after a GitHub rename. */
export async function deleteSessionsForAllowlistLogin(db: D1Database, login: string): Promise<void> {
  const trimmed = login.trim();
  if (!trimmed) return;
  const row = await db
    .prepare(`SELECT github_id FROM allowlist WHERE github_login = ? COLLATE NOCASE`)
    .bind(trimmed)
    .first<{ github_id: number | null }>();
  const githubId = row?.github_id ?? null;
  await db
    .prepare(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users
         WHERE login = ? COLLATE NOCASE
            OR (? IS NOT NULL AND github_id = ?)
       )`,
    )
    .bind(trimmed, githubId, githubId)
    .run();
}

export async function getUserBySession(
  db: D1Database,
  sessionId: string,
): Promise<SessionRecord | null> {
  const now = Math.floor(Date.now() / 1000);
  try {
    // Token columns arrive in migration 0012. Until then, sessions still load.
    const row = await db
      .prepare(
        `SELECT u.*, s.github_token_ciphertext, s.github_token_iv
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`,
      )
      .bind(sessionId, now)
      .first<SessionRecord>();
    return row ?? null;
  } catch {
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
}

function sessionUserRow(row: SessionRecord): UserRow {
  return {
    id: row.id,
    github_id: row.github_id,
    login: row.login,
    name: row.name,
    avatar_url: row.avatar_url,
    oxen_key_ciphertext: row.oxen_key_ciphertext,
    oxen_key_iv: row.oxen_key_iv,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function githubTokenFromSession(row: SessionRecord, encryptionKey: string): Promise<string> {
  if (!row.github_token_ciphertext || !row.github_token_iv || !encryptionKey) return "";
  try {
    return await decryptSecret(row.github_token_ciphertext, row.github_token_iv, encryptionKey);
  } catch {
    return "";
  }
}

/**
 * Re-check admin, allowlist, and org membership for a live session.
 * A removed person is signed out. A GitHub outage keeps the session.
 */
export async function loadAuthorizedUser(env: Env, sessionId: string): Promise<UserRow | null> {
  const row = await getUserBySession(env.DB, sessionId);
  if (!row) return null;
  const token = await githubTokenFromSession(row, env.ENCRYPTION_KEY);
  const access = await userHasAccess(env.DB, { id: row.github_id, login: row.login }, token, env);
  if (!access.allowed && access.revoke) {
    await deleteSession(env.DB, sessionId);
    return null;
  }
  return sessionUserRow(row);
}

export function toSessionUser(user: UserRow, env: Env): SessionUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    isAdmin: isAdminUser({ githubId: user.github_id, login: user.login }, env),
    hasOxenKey: Boolean(user.oxen_key_ciphertext && user.oxen_key_iv),
  };
}

/**
 * Allowlist rows are bound to the GitHub account id on first sign-in, so a later
 * rename (and someone else registering the old login) cannot inherit access.
 */
async function matchAllowlist(
  db: D1Database,
  githubId: number,
  login: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT github_login, github_id FROM allowlist
       WHERE github_id = ? OR (github_id IS NULL AND github_login = ? COLLATE NOCASE)
       ORDER BY github_id IS NULL
       LIMIT 1`,
    )
    .bind(githubId, login)
    .first<{ github_login: string; github_id: number | null }>();
  if (!row) return false;
  if (row.github_id === null) {
    await db
      .prepare(`UPDATE allowlist SET github_id = ? WHERE github_login = ? AND github_id IS NULL`)
      .bind(githubId, row.github_login)
      .run();
  } else if (row.github_login.toLowerCase() !== login.toLowerCase()) {
    // Keep the displayed login current after a rename; ignore a clash with a stale row.
    await db
      .prepare(`UPDATE OR IGNORE allowlist SET github_login = ? WHERE github_id = ?`)
      .bind(login, githubId)
      .run();
  }
  return true;
}

export type AccessDecision = {
  allowed: boolean;
  /** Drop the session. False when GitHub could not be reached. */
  revoke: boolean;
  reason?: string;
};

export async function userHasAccess(
  db: D1Database,
  ghUser: { id: number; login: string },
  accessToken: string,
  env: Env,
): Promise<AccessDecision> {
  const login = ghUser.login;
  if (isAdminUser({ githubId: ghUser.id, login }, env)) {
    return { allowed: true, revoke: false };
  }

  if (await matchAllowlist(db, ghUser.id, login)) {
    return { allowed: true, revoke: false };
  }

  const org = env.GITHUB_ORG?.trim();
  if (!org) {
    return { allowed: false, revoke: true, reason: "Not on the allowlist" };
  }
  if (!accessToken) {
    return {
      allowed: false,
      revoke: true,
      reason: `Not a member of ${org} and not on the allowlist`,
    };
  }

  let membership: Response;
  try {
    membership = await fetch(
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
  } catch {
    return {
      allowed: false,
      revoke: false,
      reason: `Unable to verify ${org} membership`,
    };
  }

  if (membership.status === 200) {
    let state: string | undefined;
    try {
      const body = (await membership.json()) as { state?: string };
      state = body.state;
    } catch {
      return {
        allowed: false,
        revoke: false,
        reason: `Unable to verify ${org} membership`,
      };
    }
    if (state === "active") return { allowed: true, revoke: false };
    return {
      allowed: false,
      revoke: true,
      reason: `Not a member of ${org} and not on the allowlist`,
    };
  }

  if (membership.status === 404 || membership.status === 401 || membership.status === 403) {
    return {
      allowed: false,
      revoke: true,
      reason: `Not a member of ${org} and not on the allowlist`,
    };
  }

  return {
    allowed: false,
    revoke: false,
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
