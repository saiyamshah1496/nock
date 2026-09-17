ALTER TABLE public.sessions DROP COLUMN temp_col;
ALTER TABLE public.sessions RENAME COLUMN archived_at TO archived_time;
ALTER TABLE public.sessions RENAME TO sessions_v2;
ALTER TABLE public.sessions DROP CONSTRAINT some_constraint;

