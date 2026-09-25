CREATE TABLE IF NOT EXISTS saved_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS saved_prompts_user_created_idx
  ON saved_prompts(user_id, created_at DESC);
