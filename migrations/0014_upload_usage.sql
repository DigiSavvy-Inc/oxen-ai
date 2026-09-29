-- Bytes each user has uploaded per UTC day, for the /api/upload daily quota.
CREATE TABLE IF NOT EXISTS upload_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
