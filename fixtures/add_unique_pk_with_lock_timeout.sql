SET lock_timeout = '3s';
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_pkey
  PRIMARY KEY (id);
