-- 0002 — Team audit enrichment columns (see Staff DB 022-team-data-plane)
-- Additive only; do not drop/rename existing columns. Keep rule_ids_json.
-- No full SQL text from clients is ever stored server-side.

ALTER TABLE audit_events ADD COLUMN estate_captured_at TEXT NULL;
ALTER TABLE audit_events ADD COLUMN freshness TEXT NULL; -- 'fresh' | 'warn' | 'stale' | 'missing'
ALTER TABLE audit_events ADD COLUMN rule_hits_json TEXT NULL; -- JSON array of {id, severity, table, n_live_tup, reason_code}

