-- Pattern-level Railway Oct 2025 shape: non-concurrent index on billion-row table
ALTER TABLE sessions ADD COLUMN archived_at timestamptz;
CREATE INDEX idx_sessions_archived_at ON sessions (archived_at);

