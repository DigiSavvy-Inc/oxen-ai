ALTER TABLE galleries ADD COLUMN handle TEXT;
ALTER TABLE galleries ADD COLUMN take_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gallery_items ADD COLUMN label TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS galleries_profile_handle_idx
  ON galleries(user_id, IFNULL(profile_id, ''), handle COLLATE NOCASE)
  WHERE handle IS NOT NULL AND length(handle) > 0;
