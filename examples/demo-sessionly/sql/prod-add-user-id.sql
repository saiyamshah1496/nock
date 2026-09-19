-- Prod prep for case C (safe metadata ADD COLUMN)
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_id bigint;
ANALYZE public.sessions;
SELECT count(*) AS rows FROM public.sessions;
SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname = 'sessions';
