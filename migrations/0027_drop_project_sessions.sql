-- Sessions were replaced by projects.draft_json / defaults_json and generations.project_id
-- (0026 folded every session into those). Nothing reads the table any more.
-- generations.session_id stays: dropping a column rewrites the table and a null column costs nothing.
DROP INDEX IF EXISTS generations_session_idx;
DROP INDEX IF EXISTS project_sessions_project_idx;
DROP TABLE IF EXISTS project_sessions;
