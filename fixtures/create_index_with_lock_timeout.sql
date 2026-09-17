SET lock_timeout = '2s';
CREATE INDEX idx_sessions_archived_at ON public.sessions (archived_at);

