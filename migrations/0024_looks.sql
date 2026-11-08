ALTER TABLE styles ADD COLUMN group_name TEXT;
ALTER TABLE styles ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS project_looks (
  project_id TEXT NOT NULL,
  style_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, style_id)
);

CREATE INDEX IF NOT EXISTS project_looks_position_idx
  ON project_looks(project_id, position);

INSERT OR IGNORE INTO project_looks (project_id, style_id, position)
  SELECT id, style_id, 0 FROM projects WHERE style_id IS NOT NULL;

ALTER TABLE project_sessions ADD COLUMN look_ids_json TEXT NOT NULL DEFAULT '[]';

UPDATE project_sessions
  SET look_ids_json = json_array(style_id)
  WHERE style_id IS NOT NULL;
