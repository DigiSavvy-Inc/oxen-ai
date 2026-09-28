ALTER TABLE sessions ADD COLUMN github_token_ciphertext TEXT;
--> statement-breakpoint
ALTER TABLE sessions ADD COLUMN github_token_iv TEXT;
