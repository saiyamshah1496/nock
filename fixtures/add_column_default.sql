-- ADD COLUMN with constant default (metadata-fast on PG11+), still hot for locks
ALTER TABLE sessions ADD COLUMN flags integer DEFAULT 0;

