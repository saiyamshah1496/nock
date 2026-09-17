-- 0003 — Partner orgs and hashed API tokens (control plane; see 023 §3.1)
-- Minimal control-plane tables for org scoping and bearer tokens hashed-at-rest.
-- Keep aligned with docs/design/023-nock-team-control-plane.md

PRAGMA foreign_keys=ON;

-- Organizations (control of token scope)
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,                  -- e.g. "acme-inc"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Partner tokens (bearers hashed-at-rest)
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,                  -- ulid/uuid
  org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,             -- sha256(<presented token string>)
  label TEXT NULL,                      -- "ci", "staging", etc.
  created_by TEXT NULL,                 -- staff login
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NULL,
  revoked_at TEXT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Helpful index for listing tokens by org (lookup remains by token_hash)
CREATE INDEX IF NOT EXISTS idx_tokens_org ON tokens(org_id);

