const MIGRATION_NAME = "0026_project_jobs.sql";

let pending: Promise<void> | null = null;

/**
 * Bring the live database up to migrations/0026_project_jobs.sql once, from the Worker,
 * and record it so `wrangler d1 migrations apply` skips the file later.
 * Mirrors ensureCastSchema for deploys whose API token cannot reach D1 directly.
 */
export function ensureJobsSchema(db: D1Database): Promise<void> {
  if (!pending) {
    pending = applyJobsSchema(db).catch((err) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}

async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).bind().all<{ name: string }>();
  return (results ?? []).some((row) => row.name === column);
}

async function addColumn(db: D1Database, table: string, definition: string): Promise<void> {
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).bind().run();
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

async function applyJobsSchema(db: D1Database): Promise<void> {
  if (await recorded(db)) return;
  if (!(await hasColumn(db, "generations", "project_id"))) {
    await addColumn(db, "generations", "project_id TEXT");
  }
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS generations_project_idx ON generations(user_id, project_id, created_at DESC)`,
    )
    .bind()
    .run();
  if (!(await hasColumn(db, "projects", "draft_json"))) {
    await addColumn(db, "projects", "draft_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!(await hasColumn(db, "projects", "defaults_json"))) {
    await addColumn(db, "projects", "defaults_json TEXT NOT NULL DEFAULT '{}'");
  }
  await db
    .prepare(
      `UPDATE generations SET project_id = (
         SELECT project_id FROM project_sessions WHERE project_sessions.id = generations.session_id
       ) WHERE project_id IS NULL AND session_id IS NOT NULL`,
    )
    .bind()
    .run();
  await db
    .prepare(
      `UPDATE projects SET
         draft_json = (
           SELECT json_object('prompt', s.prompt, 'mode', s.mode, 'model', s.model, 'settings', json(s.params_json))
           FROM project_sessions s WHERE s.project_id = projects.id ORDER BY s.updated_at DESC LIMIT 1
         ),
         defaults_json = (
           SELECT json_object('mode', s.mode, 'model', s.model, 'settings', json(s.params_json))
           FROM project_sessions s WHERE s.project_id = projects.id ORDER BY s.updated_at DESC LIMIT 1
         )
       WHERE draft_json = '{}' AND EXISTS (SELECT 1 FROM project_sessions s WHERE s.project_id = projects.id)`,
    )
    .bind()
    .run();
  await record(db);
}
