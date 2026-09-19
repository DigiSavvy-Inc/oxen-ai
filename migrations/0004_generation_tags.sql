CREATE TABLE IF NOT EXISTS generation_tags (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tag TEXT NOT NULL COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (generation_id, tag)
);

CREATE INDEX IF NOT EXISTS generation_tags_user_idx ON generation_tags(user_id, tag);
CREATE INDEX IF NOT EXISTS generation_tags_generation_idx ON generation_tags(generation_id);
