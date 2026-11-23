-- People-facing text. A caption describes the gallery; a note describes one item.
-- Neither is sent to the model. Both stay null until someone writes them.

ALTER TABLE galleries ADD COLUMN caption TEXT;
ALTER TABLE gallery_items ADD COLUMN note TEXT;
