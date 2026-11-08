const MIGRATION_NAME = "0024_looks.sql";

let pending: Promise<void> | null = null;

/**
 * Bring the live database up to migrations/0024_looks.sql once, from the Worker,
 * and record it so `wrangler d1 migrations apply` skips the file later.
 * Mirrors ensureHistoryPageSize36 for deploys that cannot reach D1 directly.
 */
export function ensureLooksSchema(db: D1Database): Promise<void> {
  if (!pending) {
    pending = applyLooksSchema(db).catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (results ?? []).some((row) => row.name === column);
}

async function addColumn(db: D1Database, table: string, definition: string): Promise<void> {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Another isolate added it first.
    if (!message.includes("duplicate column")) throw err;
  }
}

async function recorded(db: D1Database): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT id FROM d1_migrations WHERE name = ?")
      .bind(MIGRATION_NAME)
      .first();
    return Boolean(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("no such table")) return false;
    throw err;
  }
}

async function record(db: D1Database): Promise<void> {
  try {
    await db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(MIGRATION_NAME).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("unique") && !message.includes("no such table")) throw err;
  }
}

async function applyLooksSchema(db: D1Database): Promise<void> {
  if (await recorded(db)) return;
  if (!(await hasColumn(db, "styles", "group_name"))) await addColumn(db, "styles", "group_name TEXT");
  if (!(await hasColumn(db, "styles", "starred"))) {
    await addColumn(db, "styles", "starred INTEGER NOT NULL DEFAULT 0");
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS project_looks (
         project_id TEXT NOT NULL,
         style_id TEXT NOT NULL,
         position INTEGER NOT NULL,
         PRIMARY KEY (project_id, style_id)
       )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS project_looks_position_idx ON project_looks(project_id, position)`)
    .run();
  await db
    .prepare(
      `INSERT OR IGNORE INTO project_looks (project_id, style_id, position)
         SELECT id, style_id, 0 FROM projects WHERE style_id IS NOT NULL`,
    )
    .run();
  if (!(await hasColumn(db, "project_sessions", "look_ids_json"))) {
    await addColumn(db, "project_sessions", "look_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  await db
    .prepare(
      `UPDATE project_sessions SET look_ids_json = json_array(style_id)
         WHERE style_id IS NOT NULL AND look_ids_json = '[]'`,
    )
    .run();
  await record(db);
}
