-- Remediated DDL — expect PASS (or acceptable) against prod live estate.

SET lock_timeout = '2s';

-- A: non-blocking index
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_archived_at_idx
  ON public.sessions (archived_at);

-- B: metadata-only add (no rewrite)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

-- C: expand with NOT VALID check instead of immediate SET NOT NULL
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_user_id_not_null
  CHECK (user_id IS NOT NULL) NOT VALID;
