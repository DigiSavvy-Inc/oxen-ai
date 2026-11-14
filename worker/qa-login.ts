import { timingSafeEqual } from "./crypto";
import type { Env } from "./types";

/**
 * Sign-in for an after-deploy browser check (docs/smoke-checklist.md) that has no GitHub
 * session. It is off unless the deployment sets QA_LOGIN_SHA256, and it can only ever sign
 * in one fixed account: the QA user below, which is not an admin and holds no GitHub token.
 *
 * The Worker stores the SHA-256 of the secret, never the secret. Whoever runs the check
 * makes a long random secret, keeps it, and hands over only the hash.
 *
 * Turn it off by deleting QA_LOGIN_SHA256: the next request from any QA session is refused.
 */

/** GitHub account ids are positive, so no GitHub sign-in can ever be this user. */
export const QA_GITHUB_ID = -1;
/** GitHub logins cannot contain an underscore, so this cannot clash with a real one. */
export const QA_LOGIN = "studio_qa";
export const QA_NAME = "Studio QA";
/** Custom header: a cross-site form cannot send it, so it cannot plant a session. */
export const QA_HEADER = "X-Studio-QA";
/** QA sessions are short, so a replaced secret stops working within this time. */
export const QA_SESSION_TTL_SECONDS = 2 * 60 * 60;

const WINDOW_SECONDS = 10 * 60;
export const QA_MAX_ATTEMPTS_PER_WINDOW = 10;
const MIN_SECRET_LENGTH = 32;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isQaUser(githubId: number): boolean {
  return githubId === QA_GITHUB_ID;
}

/** The configured hash, or null when QA sign-in is off or the value is not a SHA-256. */
export function qaLoginHash(env: Pick<Env, "QA_LOGIN_SHA256">): string | null {
  const value = env.QA_LOGIN_SHA256?.trim().toLowerCase() ?? "";
  return SHA256_HEX.test(value) ? value : null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function qaSecretMatches(secret: unknown, env: Pick<Env, "QA_LOGIN_SHA256">): Promise<boolean> {
  const hash = qaLoginHash(env);
  if (!hash || typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) return false;
  return timingSafeEqual(await sha256Hex(secret), hash);
}

/**
 * Counts this attempt and says whether it may proceed. The limit covers every caller
 * together: only one client should ever use this route, and a shared limit cannot be
 * dodged by changing address.
 */
export async function qaAttemptAllowed(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const windowStart = now - (now % WINDOW_SECONDS);
  const row = await db
    .prepare(
      `INSERT INTO qa_login_attempts (window_start, count) VALUES (?, 1)
       ON CONFLICT(window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(windowStart)
    .first<{ count: number }>();
  await db.prepare(`DELETE FROM qa_login_attempts WHERE window_start < ?`).bind(windowStart).run();
  return (row?.count ?? 1) <= QA_MAX_ATTEMPTS_PER_WINDOW;
}
