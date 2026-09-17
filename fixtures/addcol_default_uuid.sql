-- ADD COLUMN with volatile DEFAULT gen_random_uuid()
ALTER TABLE sessions ADD COLUMN v_uuid uuid DEFAULT gen_random_uuid();

