-- Attempt counter for the optional QA sign-in (worker/qa-login.ts). One row per
-- ten-minute window; old rows are removed as new ones are written.

CREATE TABLE IF NOT EXISTS qa_login_attempts (
  window_start INTEGER PRIMARY KEY,
  count INTEGER NOT NULL
);
