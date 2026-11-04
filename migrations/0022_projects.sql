CREATE TABLE IF NOT EXISTS styles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS styles_profile_idx
  ON styles(user_id, profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  style_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS projects_profile_idx
  ON projects(user_id, profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  media_key TEXT NOT NULL,
  role TEXT,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS project_media_position_idx
  ON project_media(project_id, position);

CREATE TABLE IF NOT EXISTS project_galleries (
  project_id TEXT NOT NULL,
  gallery_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id, gallery_id)
);

CREATE TABLE IF NOT EXISTS project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  style_id TEXT,
  mode TEXT,
  model TEXT NOT NULL DEFAULT '',
  params_json TEXT NOT NULL DEFAULT '{}',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS project_sessions_project_idx
  ON project_sessions(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_shares (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS project_shares_project_idx
  ON project_shares(project_id, created_at DESC);

ALTER TABLE generations ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS generations_session_idx
  ON generations(user_id, session_id, created_at DESC);
