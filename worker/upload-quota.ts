/** Per-user daily upload budget. R2 storage is on the Studio account, not the user's Oxen key. */
export const UPLOAD_DAILY_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Atomically add `size` to today's total unless it would pass the budget.
 * Returns false (and records nothing) when the upload would go over.
 */
export async function reserveUploadBytes(
  db: D1Database,
  userId: string,
  size: number,
  now = new Date(),
): Promise<boolean> {
  if (size > UPLOAD_DAILY_BYTES) return false;
  const day = now.toISOString().slice(0, 10);
  const row = await db
    .prepare(
      `INSERT INTO upload_usage (user_id, day, bytes) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day) DO UPDATE SET bytes = bytes + excluded.bytes
       WHERE upload_usage.bytes + excluded.bytes <= ?
       RETURNING bytes`,
    )
    .bind(userId, day, size, UPLOAD_DAILY_BYTES)
    .first<{ bytes: number }>();
  return row !== null;
}
