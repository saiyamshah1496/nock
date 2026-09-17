SET lock_timeout = '3s';
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_user_fk
  FOREIGN KEY (user_id) REFERENCES public.users(id);
