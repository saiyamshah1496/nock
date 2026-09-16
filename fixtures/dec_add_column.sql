-- Nullable ADD COLUMN on hot table (Dec-shaped)
ALTER TABLE sessions ADD COLUMN archived_at timestamptz;

