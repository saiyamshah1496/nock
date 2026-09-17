-- Constant/immutable defaults should not trigger R003
ALTER TABLE sessions ADD COLUMN flags boolean DEFAULT true;
ALTER TABLE sessions ADD COLUMN tries integer DEFAULT 0;
ALTER TABLE sessions ADD COLUMN label text DEFAULT 'x';

