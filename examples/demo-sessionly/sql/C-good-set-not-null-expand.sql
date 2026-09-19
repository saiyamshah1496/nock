-- Case C GOOD (expand/contract sketch): validate with NOT VALID check first,
-- or only SET NOT NULL after backfill + validated CHECK / already-not-null catalogue.
-- For demo "green" path on staging (~200): same statement is fine size-wise;
-- on prod prefer:
--   ALTER TABLE public.sessions ADD CONSTRAINT sessions_user_id_not_null
--     CHECK (user_id IS NOT NULL) NOT VALID;
-- then VALIDATE CONSTRAINT later off-peak; then SET NOT NULL.
SET lock_timeout = '2s';
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_user_id_not_null
  CHECK (user_id IS NOT NULL) NOT VALID;
