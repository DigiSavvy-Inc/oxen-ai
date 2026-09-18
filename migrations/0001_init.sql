CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  login TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  oxen_key_ciphertext TEXT,
  oxen_key_iv TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS allowlist (
  github_login TEXT PRIMARY KEY COLLATE NOCASE,
  added_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oxen_generation_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL,
  media_type TEXT,
  result_url TEXT,
  error_message TEXT,
  params_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS generations_user_id_idx ON generations(user_id);
CREATE INDEX IF NOT EXISTS generations_oxen_id_idx ON generations(oxen_generation_id);
