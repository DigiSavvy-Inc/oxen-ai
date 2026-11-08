-- A job is one generation batch run from a project. The project link lives on
-- the generation row so the Jobs view is the library filtered by project.
ALTER TABLE generations ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS generations_project_idx
  ON generations(user_id, project_id, created_at DESC);

-- Sessions fold into one composer draft per project, plus the defaults the
-- last run left behind (mode, model, settings).
ALTER TABLE projects ADD COLUMN draft_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN defaults_json TEXT NOT NULL DEFAULT '{}';

-- Runs saved under a session belong to that session's project.
UPDATE generations SET project_id = (
  SELECT project_id FROM project_sessions WHERE project_sessions.id = generations.session_id
) WHERE project_id IS NULL AND session_id IS NOT NULL;

-- The newest session becomes the project's draft and its defaults.
UPDATE projects SET
  draft_json = (
    SELECT json_object('prompt', s.prompt, 'mode', s.mode, 'model', s.model, 'settings', json(s.params_json))
    FROM project_sessions s WHERE s.project_id = projects.id ORDER BY s.updated_at DESC LIMIT 1
  ),
  defaults_json = (
    SELECT json_object('mode', s.mode, 'model', s.model, 'settings', json(s.params_json))
    FROM project_sessions s WHERE s.project_id = projects.id ORDER BY s.updated_at DESC LIMIT 1
  )
WHERE draft_json = '{}' AND EXISTS (SELECT 1 FROM project_sessions s WHERE s.project_id = projects.id);
