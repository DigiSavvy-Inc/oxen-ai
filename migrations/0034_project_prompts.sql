-- Project prompts (#88). Named prompt text kept with one project. An Every scene prompt
-- (every_scene = 1) is on for each new job; an On request prompt is off until picked.
-- Bodies keep mention tokens exactly. Deleting a project deletes its prompts
-- (worker/projects.ts deleteProject).

CREATE TABLE IF NOT EXISTS project_prompts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  every_scene INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS project_prompts_position_idx
  ON project_prompts(project_id, position);
