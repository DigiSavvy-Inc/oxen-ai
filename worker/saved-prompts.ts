export type SavedPrompt = {
  id: string;
  body: string;
  createdAt: number;
};

export const SAVED_PROMPT_MAX_CHARS = 20_000;
export const SAVED_PROMPT_MAX_ROWS = 100;

type PromptRow = {
  id: string;
  body: string;
  created_at: number;
};

/** Keep the composer text exactly, including mention tokens. Reject blank prompts. */
export function acceptSavedPromptBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.trim()) return null;
  if (raw.length > SAVED_PROMPT_MAX_CHARS) return null;
  return raw;
}

function toPrompt(row: PromptRow): SavedPrompt {
  return { id: row.id, body: row.body, createdAt: row.created_at };
}

export async function listSavedPrompts(db: D1Database, userId: string): Promise<SavedPrompt[]> {
  const { results } = await db
    .prepare(
      `SELECT id, body, created_at FROM saved_prompts
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, SAVED_PROMPT_MAX_ROWS)
    .all<PromptRow>();
  return (results ?? []).map(toPrompt);
}

async function trimSavedPrompts(db: D1Database, userId: string): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id FROM saved_prompts
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<{ id: string }>();
  const extra = (results ?? []).slice(SAVED_PROMPT_MAX_ROWS);
  for (const row of extra) {
    await db
      .prepare(`DELETE FROM saved_prompts WHERE id = ? AND user_id = ?`)
      .bind(row.id, userId)
      .run();
  }
}

export async function saveSavedPrompt(
  db: D1Database,
  userId: string,
  raw: unknown,
): Promise<SavedPrompt | null> {
  const body = acceptSavedPromptBody(raw);
  if (!body) return null;
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare(
      `SELECT id, body, created_at FROM saved_prompts
       WHERE user_id = ? AND body = ?
       LIMIT 1`,
    )
    .bind(userId, body)
    .first<PromptRow>();
  if (existing) {
    await db
      .prepare(`UPDATE saved_prompts SET created_at = ? WHERE id = ? AND user_id = ?`)
      .bind(now, existing.id, userId)
      .run();
    return { id: existing.id, body: existing.body, createdAt: now };
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO saved_prompts (id, user_id, body, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, userId, body, now)
    .run();
  await trimSavedPrompts(db, userId);
  return { id, body, createdAt: now };
}

export async function deleteSavedPrompt(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const existing = await db
    .prepare(`SELECT id FROM saved_prompts WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<{ id: string }>();
  if (!existing) return false;
  await db
    .prepare(`DELETE FROM saved_prompts WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  return true;
}
