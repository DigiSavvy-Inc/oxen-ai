ALTER TABLE generations ADD COLUMN batch_id TEXT;
ALTER TABLE generations ADD COLUMN result_key TEXT;

CREATE INDEX IF NOT EXISTS generations_batch_id_idx ON generations(batch_id);
