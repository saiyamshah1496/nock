# Verdict JSON

Nock returns a structured JSON verdict that is identical across the CLI, GitHub Actions, and MCP.

Example (truncated):

```json
{
  "schema_version": "1",
  "verdict": "fail",
  "statements": [
    {
      "sql": "-- Pattern-level Railway Oct 2025 shape: non-concurrent index on billion-row table\nALTER TABLE sessions ADD COLUMN archived_at timestamptz",
      "lock_mode": "ACCESS EXCLUSIVE",
      "blocks_reads": true,
      "blocks_writes": true,
      "target": { "schema": "public", "name": "sessions" },
      "n_live_tup": 1040000000,
      "rules_hit": []
    },
    {
      "sql": "CREATE INDEX idx_sessions_archived_at ON sessions (archived_at)",
      "lock_mode": "SHARE",
      "blocks_reads": false,
      "blocks_writes": true,
      "target": { "schema": "public", "name": "sessions" },
      "n_live_tup": 1040000000,
      "estimated_hold_ms": { "min": 520000, "max": 1040000 },
      "estimated_hold_label": "approximate",
      "rules_hit": ["R001", "R010"]
    }
  ],
  "violations": [
    { "rule_id": "R004", "severity": "yellow", "message": "ADD COLUMN without lock_timeout on hot table sessions (1.04B rows)", "remediation_sql": "SET lock_timeout = '3s';" },
    { "rule_id": "R010", "severity": "red", "message": "Missing lock_timeout for DDL on hot table sessions (1.04B rows)", "remediation_sql": "SET lock_timeout = '3s';" },
    { "rule_id": "R001", "severity": "red", "message": "CREATE INDEX without CONCURRENTLY on sessions (1.04B rows) takes SHARE lock and may block writes", "remediation_sql": "CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <table>(<col(s)>);", "docs_url": "https://www.postgresql.org/docs/current/sql-createindex.html" }
  ],
  "meta": {
    "pg_version": "16.4",
    "estate_captured_at": "2026-09-16T05:00:00Z",
    "policy_id": "nock.postgres.ddl.default",
    "engine": "postgres"
  }
}
```

Exit codes:
- 0: pass
- 1: warn (when configured to fail on yellow)
- 2: fail

See also:
- [Rules reference](./rules.md)
- [CLI reference](./cli.md)

