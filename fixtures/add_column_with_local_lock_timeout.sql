SET LOCAL lock_timeout TO '2s';
ALTER TABLE sessions ADD COLUMN local_added_at timestamptz;

