CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS profiles_user_created_idx
  ON profiles(user_id, created_at ASC);

ALTER TABLE generations ADD COLUMN profile_id TEXT;
ALTER TABLE galleries ADD COLUMN profile_id TEXT;
ALTER TABLE user_settings ADD COLUMN active_profile_id TEXT;

CREATE INDEX IF NOT EXISTS generations_profile_idx
  ON generations(user_id, profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS galleries_profile_idx
  ON galleries(user_id, profile_id, updated_at DESC);
