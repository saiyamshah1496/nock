-- Case C BAD: SET NOT NULL on nullable user_id scans/rewrites on large tables (R005)
-- Requires public.sessions.user_id to exist (nullable). See SEED-NOTES.md.
ALTER TABLE public.sessions
  ALTER COLUMN user_id SET NOT NULL;
