SET lock_timeout = '2s';
ALTER TABLE sessions ALTER COLUMN archived_at SET NOT NULL;

