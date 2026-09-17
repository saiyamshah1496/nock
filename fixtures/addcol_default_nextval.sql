-- ADD COLUMN with volatile DEFAULT nextval()
ALTER TABLE sessions ADD COLUMN v_id bigint DEFAULT nextval('sessions_v_id_seq');

