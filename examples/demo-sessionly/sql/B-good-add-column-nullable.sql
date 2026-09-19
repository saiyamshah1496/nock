-- Case B GOOD: nullable ADD COLUMN is metadata-only (no rewrite)
ALTER TABLE public.sessions
  ADD COLUMN created_at timestamptz;
