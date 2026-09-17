ALTER TABLE sessions ADD CONSTRAINT sessions_archived_nn CHECK (archived_at IS NOT NULL) NOT VALID;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_archived_nn;
ALTER TABLE sessions ALTER COLUMN archived_at SET NOT NULL;

