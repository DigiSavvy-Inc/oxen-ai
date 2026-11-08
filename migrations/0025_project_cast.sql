ALTER TABLE projects ADD COLUMN budget INTEGER NOT NULL DEFAULT 20;

ALTER TABLE project_media ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE project_galleries ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

-- Per-project state for one gallery item in the cast. Keyed by media key because
-- saving a gallery rewrites its item ids.
CREATE TABLE IF NOT EXISTS project_cast_items (
  project_id TEXT NOT NULL,
  gallery_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  excluded INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  PRIMARY KEY (project_id, gallery_id, media_key)
);

-- Pinned files become loose cast items. They follow the linked galleries so the
-- numbers a project already used stay where they were.
UPDATE project_media SET position = position + (
  SELECT COALESCE(MAX(position) + 1, 0) FROM project_galleries
  WHERE project_galleries.project_id = project_media.project_id
);
