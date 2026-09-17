-- Should RED on hot table (R001) given estate from seed
CREATE INDEX idx_sessions_archived_at_ci ON public.sessions (archived_at);

