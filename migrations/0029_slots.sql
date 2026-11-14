-- A slot is a named set of files and an optional note on the profile.
-- project_id null means the slot works everywhere. A set project means it
-- works only while that project is open.

CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  project_id TEXT,
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  take_count INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  gallery_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS slots_everywhere_handle_idx
  ON slots(user_id, IFNULL(profile_id, ''), handle COLLATE NOCASE)
  WHERE project_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS slots_project_handle_idx
  ON slots(project_id, handle COLLATE NOCASE)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS slots_profile_idx
  ON slots(user_id, IFNULL(profile_id, ''), position ASC);

CREATE TABLE IF NOT EXISTS slot_files (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  media_key TEXT NOT NULL,
  label TEXT,
  role TEXT,
  position INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS slot_files_slot_idx
  ON slot_files(slot_id, position ASC);

CREATE UNIQUE INDEX IF NOT EXISTS slot_files_label_idx
  ON slot_files(slot_id, label COLLATE NOCASE)
  WHERE label IS NOT NULL AND length(label) > 0;
