const MIGRATION_NAME = "0025_project_cast.sql";

let pending: Promise<void> | null = null;

/**
 * Bring the live database up to migrations/0025_project_cast.sql once, from the Worker,
 * and record it so `wrangler d1 migrations apply` skips the file later.
 * Mirrors ensureLooksSchema for deploys whose API token cannot reach D1 directly.
 */
export function ensureCastSchema(db: D1Database): Promise<void> {
  if (!pending) {
    pending = applyCastSchema(db).catch((err) => {
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

async function applyCastSchema(db: D1Database): Promise<void> {
  if (await recorded(db)) return;
  if (!(await hasColumn(db, "projects", "budget"))) {
    await addColumn(db, "projects", "budget INTEGER NOT NULL DEFAULT 20");
  }
  // Pinned files join the cast after the galleries that were already there. The shift
  // runs only with the first schema change so a retried bump cannot move them twice.
  const firstPass = !(await hasColumn(db, "project_media", "active"));
  if (firstPass) {
    await addColumn(db, "project_media", "active INTEGER NOT NULL DEFAULT 1");
  }
  if (!(await hasColumn(db, "project_galleries", "active"))) {
    await addColumn(db, "project_galleries", "active INTEGER NOT NULL DEFAULT 1");
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS project_cast_items (
         project_id TEXT NOT NULL,
         gallery_id TEXT NOT NULL,
         media_key TEXT NOT NULL,
         active INTEGER NOT NULL DEFAULT 1,
         excluded INTEGER NOT NULL DEFAULT 0,
         role TEXT,
         PRIMARY KEY (project_id, gallery_id, media_key)
       )`,
    )
    .run();
  if (firstPass) {
    await db
      .prepare(
        `UPDATE project_media SET position = position + (
           SELECT COALESCE(MAX(position) + 1, 0) FROM project_galleries
           WHERE project_galleries.project_id = project_media.project_id
         )`,
      )
      .run();
  }
  await record(db);
}
