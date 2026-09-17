ALTER TABLE public.sessions
  ALTER COLUMN archived_at TYPE integer USING extract(epoch FROM archived_at)::integer;

