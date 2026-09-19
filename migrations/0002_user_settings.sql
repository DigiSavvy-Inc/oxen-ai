CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_model_by_mode TEXT NOT NULL DEFAULT '{}',
  last_params TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
