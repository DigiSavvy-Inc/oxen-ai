-- Seconds into a gallery video, stored as milliseconds, used when grabbing a still.
ALTER TABLE user_settings ADD COLUMN video_thumb_ms INTEGER NOT NULL DEFAULT 1000;
