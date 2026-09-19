-- Naive first-draft DDL (ORM-like). Against prod live estate (~500k) expect RED:
--   R001 — CREATE INDEX without CONCURRENTLY
--   R010 — missing lock_timeout on hot DDL (if enabled in policy)
--   R003 — ADD COLUMN with volatile DEFAULT (rewrite)
--   R005 — SET NOT NULL on nullable user_id (after prod-add-user-id.sql)
-- Against estate-staging.json (~200 n_live_tup) expect PASS or yellow-only.

-- A: blocking index
CREATE INDEX sessions_archived_at_idx ON public.sessions (archived_at);

-- B: volatile default rewrite
ALTER TABLE public.sessions
  ADD COLUMN created_at timestamptz DEFAULT now();

-- C: SET NOT NULL (requires user_id column — see prod-add-user-id.sql)
ALTER TABLE public.sessions
  ALTER COLUMN user_id SET NOT NULL;
