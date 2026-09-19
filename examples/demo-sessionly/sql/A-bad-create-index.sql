-- Case A BAD: blocks writes on hot/prod-sized tables (R001 / R010)
-- Against prod (~500k) expect RED. Against estate-staging.json (~200) expect pass/quiet.
CREATE INDEX sessions_archived_at_idx ON public.sessions (archived_at);
