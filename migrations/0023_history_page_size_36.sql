-- History and gallery cards show 12 more items than the previous default of 24.
UPDATE user_settings SET history_page_size = 36 WHERE history_page_size = 24;
