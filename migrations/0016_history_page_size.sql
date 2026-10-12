-- How many history groups the library shows per page. Default is 24.
ALTER TABLE user_settings ADD COLUMN history_page_size INTEGER NOT NULL DEFAULT 24;
