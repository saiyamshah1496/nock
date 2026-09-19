-- Good: set a lock_timeout and use CONCURRENTLY
SET lock_timeout = '3s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_archived_at ON public.sessions(archived_at);

