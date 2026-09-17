-- E2E smoke: should RED on hot table (R001)
CREATE INDEX idx_sessions_user ON public.sessions (user_id);
