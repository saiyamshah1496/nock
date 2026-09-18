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

-- Governance catalogue objects for integration assertions:
-- 1) Unique index on name (non-partial, valid/ready/live/immediate true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_name_unique ON public.widgets (name);

-- 2) Expression index (columns should be empty; no expression text stored)
CREATE INDEX IF NOT EXISTS idx_widgets_name_lower ON public.widgets ((lower(name)));

-- 3) NOT VALID foreign key from widgets(session_id) -> sessions(id)
ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS session_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint co
    JOIN pg_class c ON c.oid = co.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'widgets' AND co.conname = 'widgets_session_fk'
  ) THEN
    ALTER TABLE public.widgets
      ADD CONSTRAINT widgets_session_fk FOREIGN KEY (session_id) REFERENCES public.sessions(id) NOT VALID;
  END IF;
END$$;

-- Refresh stats so pg_stat_user_tables is populated
ANALYZE public.sessions;
ANALYZE public.widgets;

