-- Idempotent seed for CI estate-sync integration
-- Creates two tables:
-- 1) public.sessions — "hot" table with >= 20k rows
-- 2) public.widgets — tiny table with <= 10 rows
-- Then ANALYZE to populate stats

CREATE SCHEMA IF NOT EXISTS public;

CREATE TABLE IF NOT EXISTS public.sessions (
  id BIGINT PRIMARY KEY,
  archived_at TIMESTAMPTZ
);

-- Insert 25k rows if missing (idempotent via ON CONFLICT)
INSERT INTO public.sessions (id, archived_at)
SELECT gs, NULL::timestamptz
FROM generate_series(1, 25000) AS gs
ON CONFLICT (id) DO NOTHING;

-- Tiny table
CREATE TABLE IF NOT EXISTS public.widgets (
  id BIGINT PRIMARY KEY,
  name TEXT
);

INSERT INTO public.widgets (id, name)
SELECT gs, CONCAT('w-', gs::text)
FROM generate_series(1, 10) AS gs
ON CONFLICT (id) DO NOTHING;

-- Refresh stats so pg_stat_user_tables is populated
ANALYZE public.sessions;
ANALYZE public.widgets;

