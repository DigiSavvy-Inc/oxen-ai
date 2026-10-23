-- Favorite order and composer presets (count, aspect, quality, resolution).
ALTER TABLE user_settings ADD COLUMN composer_prefs TEXT NOT NULL DEFAULT '{}';
