-- Time-stable defaults should not R003 (per product lock)
ALTER TABLE sessions ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE sessions ADD COLUMN created_ts timestamptz DEFAULT CURRENT_TIMESTAMP;

