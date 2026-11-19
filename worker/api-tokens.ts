import { loadAuthorizedUser, userHasAccess } from "./auth";
import { timingSafeEqual } from "./crypto";
import type { Env, UserRow } from "./types";

/**
 * Personal API tokens (#78). A token signs a script in as its owner, limited to the routes in
 * worker/api-scope.ts and a daily dollar cap. Only the SHA-256 of a token is stored. The token
 * is returned once, on create, and must never be logged.
 */

export const TOKEN_PREFIX = "dss_";
/** dss_ plus 32 random bytes as base64url (43 characters, no padding). */
const TOKEN_PATTERN = /^dss_[A-Za-z0-9_-]{43}$/;
export const TOKEN_DISPLAY_PREFIX_LENGTH = 8;
export const TOKEN_MAX_LIVE = 10;
export const TOKEN_NAME_MAX = 60;
export const TOKEN_CAP_MIN_USD = 0.5;
export const TOKEN_CAP_MAX_USD = 500;
/** Shown when a token's owner no longer passes the access checks. */
export const TOKEN_ACCESS_LOST =
  "Sign in to Studio in a browser to use this token again.";

const ATTEMPT_WINDOW_SECONDS = 10 * 60;
export const TOKEN_MAX_FAILURES_PER_WINDOW = 20;
/** Float slack when comparing fractional cents against the cap. */
const CENT_EPSILON = 0.000001;

export type ApiTokenJson = {
  id: string;
  name: string;
  prefix: string;
  dailyCapUsd: number;
  spentTodayUsd: number;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ApiTokenFailure = "name" | "cap" | "limit" | "unavailable";

export type SignedInToken = {
  id: string;
  name: string;
  dailyCapCents: number;
};

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  daily_cap_cents: number;
  created_at: number;
  last_used_at: number | null;
};

export function missingTokenStorage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table") || message.includes("no such column");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The spend day, always UTC. */
export function utcDay(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateToken(): string {
  return `${TOKEN_PREFIX}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function looksLikeToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function acceptTokenName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > TOKEN_NAME_MAX) return null;
  return name;
}

/** The cap in whole cents, or null when it is missing or outside $0.50–$500. */
export function acceptDailyCapCents(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < TOKEN_CAP_MIN_USD || raw > TOKEN_CAP_MAX_USD) return null;
  return Math.round(raw * 100);
}

/** A run's price in cents, kept to a hundredth of a cent. */
function costCents(amountUsd: number): number {
  return Math.round(amountUsd * 100 * 100) / 100;
}

/**
 * What a token run counts against the cap, or null when Studio has no usable price for it:
 * no price, zero, negative, NaN, or infinite. A run that would count as nothing could never
 * reach the cap, so a token may not run it.
 */
export function tokenRunCents(amountUsd: number | null | undefined): number | null {
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  const cents = costCents(amountUsd);
  return cents > 0 ? cents : null;
}

export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

/** Spend rounds up so the shown figure never understates what was used. */
function spentUsd(cents: number): number {
  return Math.max(0, Math.ceil(cents - CENT_EPSILON)) / 100;
}

export function formatDollars(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function capExceededMessage(capCents: number, spentCents: number): string {
  return `This token's daily limit of ${formatDollars(centsToUsd(capCents))} is used up (${formatDollars(
    spentUsd(spentCents),
  )} spent today).`;
}

export async function spentTodayCents(
  db: D1Database,
  tokenId: string,
  day = utcDay(),
): Promise<number> {
  const row = await db
    .prepare(`SELECT cents FROM api_token_spend WHERE token_id = ? AND day = ?`)
    .bind(tokenId, day)
    .first<{ cents: number }>();
  return Number(row?.cents ?? 0);
}

function toJson(row: TokenRow, spentCents: number): ApiTokenJson {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    dailyCapUsd: centsToUsd(row.daily_cap_cents),
    spentTodayUsd: spentUsd(spentCents),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

async function liveTokenRows(db: D1Database, userId: string): Promise<TokenRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, prefix, daily_cap_cents, created_at, last_used_at FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<TokenRow>();
  return results ?? [];
}

/** Live tokens for the Settings list. `ready` is false until the migration is applied. */
export async function listTokens(
  db: D1Database,
  userId: string,
): Promise<{ tokens: ApiTokenJson[]; ready: boolean }> {
  try {
    const rows = await liveTokenRows(db, userId);
    const day = utcDay();
    const tokens = await Promise.all(
      rows.map(async (row) => toJson(row, await spentTodayCents(db, row.id, day))),
    );
    return { tokens, ready: true };
  } catch (err) {
    if (!missingTokenStorage(err)) throw err;
    return { tokens: [], ready: false };
  }
}

export async function createToken(
  db: D1Database,
  userId: string,
  input: { name: unknown; dailyCapUsd: unknown },
): Promise<{ token: string; item: ApiTokenJson } | { error: ApiTokenFailure }> {
  const name = acceptTokenName(input.name);
  if (!name) return { error: "name" };
  const capCents = acceptDailyCapCents(input.dailyCapUsd);
  if (capCents == null) return { error: "cap" };
  const token = generateToken();
  const row: TokenRow = {
    id: crypto.randomUUID(),
    name,
    prefix: token.slice(0, TOKEN_DISPLAY_PREFIX_LENGTH),
    daily_cap_cents: capCents,
    created_at: nowSeconds(),
    last_used_at: null,
  };
  const tokenHash = await hashToken(token);
  // One statement counts the live tokens and inserts only while there are fewer than the
  // limit, so two creates at once cannot both land on the last place.
  let inserted: number;
  try {
    const result = await db
      .prepare(
        `INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, daily_cap_cents, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL) < ?`,
      )
      .bind(
        row.id,
        userId,
        row.name,
        tokenHash,
        row.prefix,
        row.daily_cap_cents,
        row.created_at,
        userId,
        TOKEN_MAX_LIVE,
      )
      .run();
    inserted = Number(result.meta?.changes ?? 0);
  } catch (err) {
    if (!missingTokenStorage(err)) throw err;
    return { error: "unavailable" };
  }
  if (inserted === 0) return { error: "limit" };
  return { token, item: toJson(row, 0) };
}

/** True when a live token of this user was revoked. */
export async function revokeToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .bind(nowSeconds(), id, userId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  } catch (err) {
    if (!missingTokenStorage(err)) throw err;
    return false;
  }
}

function attemptWindow(now: number): number {
  return now - (now % ATTEMPT_WINDOW_SECONDS);
}

async function failuresThisWindow(db: D1Database, ip: string, now: number): Promise<number> {
  const row = await db
    .prepare(`SELECT count FROM api_token_attempts WHERE ip = ? AND window_start = ?`)
    .bind(ip, attemptWindow(now))
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function noteFailure(db: D1Database, ip: string, now: number): Promise<void> {
  const windowStart = attemptWindow(now);
  await db
    .prepare(
      `INSERT INTO api_token_attempts (ip, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1`,
    )
    .bind(ip, windowStart)
    .run();
  await db.prepare(`DELETE FROM api_token_attempts WHERE window_start < ?`).bind(windowStart).run();
}

/**
 * Admins and allowlisted users pass on the D1 checks alone. An org member passes while one of
 * their unexpired browser sessions still passes the session check, which re-asks GitHub when
 * the last org confirmation is stale and ends the session if they left the org.
 */
export async function tokenOwnerHasAccess(env: Env, user: UserRow): Promise<boolean> {
  const direct = await userHasAccess(env.DB, { id: user.github_id, login: user.login }, "", env);
  if (direct.allowed) return true;
  if (!env.GITHUB_ORG?.trim()) return false;
  const { results } = await env.DB.prepare(
    `SELECT id FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 3`,
  )
    .bind(user.id, nowSeconds())
    .all<{ id: string }>();
  for (const session of results ?? []) {
    if (await loadAuthorizedUser(env, session.id)) return true;
  }
  return false;
}

export type BearerResult =
  | { ok: true; user: UserRow; token: SignedInToken }
  | { ok: false; status: 401 | 429; message: string };

/** Signs a bearer token in. Unknown, malformed, and revoked tokens count against the address. */
export async function authenticateBearer(
  env: Env,
  presented: string,
  ip: string,
  now = nowSeconds(),
): Promise<BearerResult> {
  const unauthorized: BearerResult = { ok: false, status: 401, message: "Unauthorized" };
  try {
    if ((await failuresThisWindow(env.DB, ip, now)) >= TOKEN_MAX_FAILURES_PER_WINDOW) {
      return { ok: false, status: 429, message: "Too many failed token attempts. Try again in ten minutes." };
    }
  } catch (err) {
    // Before the migration there are no tokens, so every bearer is refused.
    if (missingTokenStorage(err)) return unauthorized;
    throw err;
  }
  const hash = await hashToken(presented);
  const row = looksLikeToken(presented)
    ? await env.DB.prepare(
        `SELECT t.id AS token_id, t.name AS token_name, t.daily_cap_cents, t.last_used_at AS token_last_used_at,
                t.token_hash, u.*
         FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
      )
        .bind(hash)
        .first<
          UserRow & {
            token_id: string;
            token_name: string;
            daily_cap_cents: number;
            token_last_used_at: number | null;
            token_hash: string;
          }
        >()
    : null;
  if (!row || !(await timingSafeEqual(row.token_hash, hash))) {
    await noteFailure(env.DB, ip, now);
    return unauthorized;
  }
  const user: UserRow = {
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
  if (!(await tokenOwnerHasAccess(env, user))) {
    return { ok: false, status: 401, message: TOKEN_ACCESS_LOST };
  }
  if (row.token_last_used_at == null || now - row.token_last_used_at >= 60) {
    await env.DB.prepare(
      `UPDATE api_tokens SET last_used_at = ?
       WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)`,
    )
      .bind(now, row.token_id, now - 60)
      .run();
  }
  return {
    ok: true,
    user,
    token: { id: row.token_id, name: row.token_name, dailyCapCents: row.daily_cap_cents },
  };
}

/**
 * Adds this run to today's spend in one statement that only lands while the total stays within
 * the cap, so two runs at once cannot both pass. Returns false when the run would go over.
 */
export async function reserveSpend(
  db: D1Database,
  token: SignedInToken,
  cents: number,
  day = utcDay(),
): Promise<boolean> {
  const limit = token.dailyCapCents + CENT_EPSILON;
  const row = await db
    .prepare(
      `INSERT INTO api_token_spend (token_id, day, cents)
       SELECT ?, ?, ? WHERE ? <= ?
       ON CONFLICT(token_id, day) DO UPDATE SET cents = api_token_spend.cents + excluded.cents
       WHERE api_token_spend.cents + excluded.cents <= ?
       RETURNING cents`,
    )
    .bind(token.id, day, cents, cents, limit, limit)
    .first<{ cents: number }>();
  return row != null;
}

/** Gives back a reservation for a run that never reached the queue. */
export async function releaseSpend(
  db: D1Database,
  tokenId: string,
  cents: number,
  day = utcDay(),
): Promise<void> {
  await db
    .prepare(
      `UPDATE api_token_spend SET cents = MAX(0, cents - ?) WHERE token_id = ? AND day = ?`,
    )
    .bind(cents, tokenId, day)
    .run();
}

/** The `token` block on GET /api/auth/me for a token request. Never carries the Oxen key. */
export async function tokenSummary(
  db: D1Database,
  token: SignedInToken,
): Promise<{ name: string; dailyCapUsd: number; spentTodayUsd: number }> {
  return {
    name: token.name,
    dailyCapUsd: centsToUsd(token.dailyCapCents),
    spentTodayUsd: spentUsd(await spentTodayCents(db, token.id)),
  };
}
