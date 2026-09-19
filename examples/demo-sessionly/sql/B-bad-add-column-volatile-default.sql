-- Case B BAD: ADD COLUMN with volatile DEFAULT rewrites the table (R003)
ALTER TABLE public.sessions
  ADD COLUMN created_at timestamptz DEFAULT now();
