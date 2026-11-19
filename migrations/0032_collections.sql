-- Collections (#67): one level above galleries. Membership lives on the gallery row, so a
-- gallery is in one collection or none. No backfill: every existing gallery starts ungrouped.

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  name TEXT NOT NULL,
  cover_key TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS collections_profile_idx
  ON collections(user_id, IFNULL(profile_id, ''), position ASC);

ALTER TABLE galleries ADD COLUMN collection_id TEXT;
ALTER TABLE galleries ADD COLUMN collection_position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS galleries_collection_idx
  ON galleries(user_id, collection_id, collection_position ASC);
