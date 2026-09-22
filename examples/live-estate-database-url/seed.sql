-- Create a hot-ish sessions table and seed rows (idempotent-ish)
CREATE SCHEMA IF NOT EXISTS public;
CREATE TABLE IF NOT EXISTS public.sessions (
  id bigserial PRIMARY KEY,
  user_id bigint,
  archived_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Seed ~1.2M rows when empty
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.sessions) = 0 THEN
    INSERT INTO public.sessions (user_id, archived_at, created_at)
    SELECT (random()*100000)::bigint, NULL, now() - (g * interval '1 second')
    FROM generate_series(1, 1200000) AS g;
  END IF;
END$$;

-- Reset per-table write counters so \"good\" CIC example reflects post-reset activity
-- (R025 counters are since stats reset).
SELECT pg_stat_reset_single_table_counters('public.sessions'::regclass);

-- Refresh stats so n_live_tup reflects seeded row count for size-gated tests
ANALYZE public.sessions;

