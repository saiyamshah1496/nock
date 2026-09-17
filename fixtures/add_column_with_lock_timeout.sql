SET lock_timeout = '2s';
ALTER TABLE sessions ADD COLUMN added_at timestamptz;

