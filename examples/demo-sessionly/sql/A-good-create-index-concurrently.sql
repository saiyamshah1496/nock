-- Case A GOOD: non-blocking index build + lock_timeout
SET lock_timeout = '2s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_archived_at_idx
  ON public.sessions (archived_at);
