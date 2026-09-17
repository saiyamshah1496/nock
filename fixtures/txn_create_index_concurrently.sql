BEGIN;
CREATE INDEX CONCURRENTLY idx_sessions_archived_at ON sessions (archived_at);
COMMIT;
