-- ADD CHECK without NOT VALID (Datapace-shaped)
ALTER TABLE sessions ADD CONSTRAINT sessions_archived_chk CHECK (id >= 0);

