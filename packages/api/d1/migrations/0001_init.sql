-- D1 initial schema for Nock org policy + audit (Team)
-- Note: Do not store full migration SQL; only hashes and minimal metadata.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  repo_id TEXT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_org_repo_version
  ON policies (org_id, repo_id, version);
CREATE INDEX IF NOT EXISTS idx_policies_lookup
  ON policies (org_id, repo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  sql_hash TEXT NOT NULL,
  verdict TEXT NOT NULL, -- 'pass' | 'fail'
  rule_ids_json TEXT NOT NULL,
  policy_version INTEGER NULL,
  actor TEXT NULL,
  ci_run_id TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_repo_created
  ON audit_events (repo_id, created_at DESC);

