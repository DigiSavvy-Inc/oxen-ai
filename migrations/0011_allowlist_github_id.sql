-- Bind allowlist entries to the immutable GitHub account id (set on first sign-in),
-- so a renamed or deleted login cannot be re-registered to inherit access.
ALTER TABLE allowlist ADD COLUMN github_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS allowlist_github_id ON allowlist (github_id) WHERE github_id IS NOT NULL;
