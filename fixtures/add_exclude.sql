ALTER TABLE public.sessions ADD CONSTRAINT exclude_overlaps EXCLUDE USING gist (tsrange(archived_at, archived_at) WITH &&);

