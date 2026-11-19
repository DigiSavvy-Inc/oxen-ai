-- Personal API tokens (#78). A script or agent sends `Authorization: Bearer dss_…` and acts as
-- the owner, limited to the routes in worker/api-scope.ts and a daily dollar cap per token.
-- Only the SHA-256 of a token is stored; the token itself is shown once, on create.

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  daily_cap_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id, created_at);

-- What each token has queued per UTC day. Cents may be fractional: a cheap image costs less
-- than one cent, and rounding every run up would spend the cap too early.
CREATE TABLE IF NOT EXISTS api_token_spend (
  token_id TEXT NOT NULL,
  day TEXT NOT NULL,
  cents REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, day)
);

-- Failed bearer sign-ins per address, one row per ten-minute window, so tokens cannot be
-- guessed at speed. Old rows are removed as new ones are written.
CREATE TABLE IF NOT EXISTS api_token_attempts (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip, window_start)
);
