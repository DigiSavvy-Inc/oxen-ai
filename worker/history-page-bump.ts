const MIGRATION_NAME = "0023_history_page_size_36.sql";

let pending: Promise<void> | null = null;

/** Move accounts still on the old history default of 24 to 36, once. */
export function ensureHistoryPageSize36(db: D1Database): Promise<void> {
  if (!pending) {
    pending = applyHistoryPageSize36(db).catch(() => {
      pending = null;
    });
  }
  return pending;
}

async function applyHistoryPageSize36(db: D1Database): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM d1_migrations WHERE name = ?")
    .bind(MIGRATION_NAME)
    .first();
  if (existing) return;
  await db.prepare("UPDATE user_settings SET history_page_size = 36 WHERE history_page_size = 24").run();
  try {
    await db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(MIGRATION_NAME).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!message.toLowerCase().includes("unique")) throw err;
  }
}
