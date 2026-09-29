-- Last time GitHub confirmed org membership for this session, so the per-request
-- access re-check only calls GitHub every 15 minutes instead of on every poll.
ALTER TABLE sessions ADD COLUMN org_checked_at INTEGER;
