-- Bad: non-concurrent index creation on a hot table, no lock_timeout
CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);

