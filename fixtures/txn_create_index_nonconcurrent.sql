BEGIN;
CREATE INDEX idx_sessions_archived_at ON sessions (archived_at);
COMMIT;
