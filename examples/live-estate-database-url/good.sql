SET lock_timeout = '3s'; -- set a short lock timeout before online index build
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_archived_at ON public.sessions(archived_at);

