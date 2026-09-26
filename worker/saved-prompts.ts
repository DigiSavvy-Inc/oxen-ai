export type SavedPrompt = {
  id: string;
  name: string;
  body: string;
  createdAt: number;
};

export const SAVED_PROMPT_MAX_CHARS = 20_000;
export const SAVED_PROMPT_NAME_MAX = 80;
export const SAVED_PROMPT_MAX_ROWS = 100;

type PromptRow = {
  id: string;
  name: string;
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

export function acceptSavedPromptName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > SAVED_PROMPT_NAME_MAX) return null;
  return name;
}

function toPrompt(row: PromptRow): SavedPrompt {
  return { id: row.id, name: row.name ?? "", body: row.body, createdAt: row.created_at };
}

export async function listSavedPrompts(db: D1Database, userId: string): Promise<SavedPrompt[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, body, created_at FROM saved_prompts
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
  input: { name: unknown; body: unknown },
): Promise<SavedPrompt | null> {
  const name = acceptSavedPromptName(input.name);
  const body = acceptSavedPromptBody(input.body);
  if (!name || !body) return null;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO saved_prompts (id, user_id, name, body, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, name, body, now)
    .run();
  await trimSavedPrompts(db, userId);
  return { id, name, body, createdAt: now };
}

export async function updateSavedPrompt(
  db: D1Database,
  userId: string,
  id: string,
  input: { name: unknown; body: unknown },
): Promise<{ prompt: SavedPrompt } | { error: "invalid" | "missing" }> {
  const name = acceptSavedPromptName(input.name);
  const body = acceptSavedPromptBody(input.body);
  if (!name || !body) return { error: "invalid" };
  const existing = await db
    .prepare(`SELECT id FROM saved_prompts WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<{ id: string }>();
  if (!existing) return { error: "missing" };
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE saved_prompts SET name = ?, body = ?, created_at = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(name, body, now, id, userId)
    .run();
  return { prompt: { id, name, body, createdAt: now } };
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
