-- A slot's type: image, audio, video, or text. It is a label for grouping and
-- filtering the slots list. It does not limit which files a slot can hold.

ALTER TABLE slots ADD COLUMN slot_type TEXT NOT NULL DEFAULT 'text';

-- Backfill. A slot with no files is text. Otherwise it takes the kind most of
-- its files have, and a tie goes to the kind of the first file. A slot linked to
-- a gallery counts that gallery's items instead; a deleted gallery counts as none.
UPDATE slots SET slot_type = COALESCE(
  (
    SELECT kind FROM (
      SELECT f.kind AS kind, COUNT(*) AS n, MIN(f.position) AS first
      FROM slot_files f
      WHERE f.slot_id = slots.id AND slots.gallery_id IS NULL
        AND f.kind IN ('image', 'video', 'audio')
      GROUP BY f.kind
      UNION ALL
      SELECT gi.kind AS kind, COUNT(*) AS n, MIN(gi.position) AS first
      FROM gallery_items gi
      JOIN galleries g ON g.id = gi.gallery_id
      WHERE gi.gallery_id = slots.gallery_id
        AND gi.kind IN ('image', 'video', 'audio')
      GROUP BY gi.kind
    )
    ORDER BY n DESC, first ASC
    LIMIT 1
  ),
  'text'
);
