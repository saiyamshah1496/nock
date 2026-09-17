# Nock

Nock gates risky Postgres migrations before they merge.
It checks your DDL against an estate snapshot (table sizes) and policy — lock class, `lock_timeout`, hot‑table risk — and returns approve or block.
Pattern linters catch shapes. Nock catches “this is unsafe on your data.”
Nock never applies migrations. CLI ≡ Action ≡ MCP — the same verdict JSON for the same inputs.

## Install

```bash
corepack enable
pnpm install
pnpm build
```

## What is an estate?

An estate is a small JSON snapshot of your Postgres tables’ sizes that Nock uses to reason about locks and risk on your actual data. It is not a dump — no row contents, no passwords.

Minimal shape:

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000 }
  ]
}
```

## Quick start: check a migration with an estate file

```bash
node packages/cli/dist/bin/nock.js check \
  --sql fixtures/railway_oct.sql \
  --estate fixtures/estate_billion.json \
  --format json
```

Exit codes: 0 pass, 1 warn-only (yellow when fail_on=yellow), 2 fail.

Two ways to provide an estate:
- Bring your own estate — paste/commit `.nock/estate.json`: see `docs/guides/quick-start-estate-file.md`
- Sync estate yourself — run `nock sync-estate` on your runner: see `docs/guides/sync-estate.md`

### Example: input → output

Input A — migration SQL (`fixtures/railway_oct.sql`)

```sql
ALTER TABLE sessions ADD COLUMN archived_at timestamptz;
CREATE INDEX idx_sessions_archived_at ON sessions (archived_at);
```

Input B — estate excerpt (`fixtures/estate_billion.json`)

```json
{
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000 }
  ]
}
```

Command

```bash
node packages/cli/dist/bin/nock.js check --sql fixtures/railway_oct.sql --estate fixtures/estate_billion.json --format json
```

Output (real CLI JSON)

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
    { "rule_id": "R001", "severity": "red", "message": "CREATE INDEX without CONCURRENTLY on sessions (1.04B rows) takes SHARE lock and may block writes", "remediation_sql": "CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <table>(<col(s)>);", "docs_url": "https://www.postgresql.org/docs/current/sql-createindex.html" },
    { "rule_id": "R010", "severity": "red", "message": "Missing lock_timeout for DDL on hot table sessions (1.04B rows)", "remediation_sql": "SET lock_timeout = '3s';" }
  ],
  "meta": {
    "pg_version": "16.4",
    "estate_captured_at": "2026-09-16T05:00:00Z",
    "policy_id": "nock.postgres.ddl.default",
    "engine": "postgres"
  }
}
```

Exit code: 2 (fail). 1 = warn when `fail_on=yellow`. 0 = pass.

## Keep estate fresh with sync-estate

Generate `.nock/estate.json` with a read‑only role (prefer a replica) on your own GitHub runner and use it in PR checks. Guide: `docs/guides/sync-estate.md`

## Add Nock to GitHub Actions

See `packages/action/action.yml` and copy into `.github/workflows/nock.yml`:

```yaml
name: Nock
on:
  pull_request:
    paths: ['migrations/**', '.nock/**']
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Nock check
        uses: ./.github/actions/nock  # example-only; replace with your published action or use CLI
        with:
          migration-path: migrations/
          # Optional: download hosted estate to file (Team)
          # estate-api-url: https://example.workers.dev/v1/estate/my-repo
          # estate-api-token: ${{ secrets.NOCK_ESTATE_API_TOKEN }}
          # File fallback (OSS/local)
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Prefer the CLI workflow in `examples/workflows/nock.yml` if you’re not using a published Action yet — the `uses: ./.github/actions/nock` path above is example‑only until a package is published. GitHub App later.

## How to read results

- Green: safe to merge
- Yellow: risky or unknown pattern; warn by default, or fail when `fail-on: yellow`
- Red: unsafe; fix or defer until off-peak or with mitigations
- Exit codes: 0 pass, 1 warn-only (when `fail-on: yellow`), 2 fail

## Grants for sync-estate

Create a least‑privilege read‑only role that can run the catalogue query (no row data) and prefer connecting to a replica. Guide: `docs/guides/grants-sync-estate.md`

## MCP: check before apply

See `@nock/mcp` — provides `check_before_apply`, `explain_lock`, `list_rules`. Golden tests ensure CLI JSON equals MCP JSON on identical inputs. Guide: `docs/guides/mcp-check-before-apply.md` (use the from‑source config in the guide until packages are published; `npx @nock/mcp` will work after publish).

## Rules

| Rule | Status | Notes |
|------|--------|-------|
| R001 — CREATE INDEX w/o CONCURRENTLY | Implemented | Lock mode SHARE; red ≥10k rows |
| R002 — CIC inside transaction | Stub | Will add matcher |
| R003 — ADD COLUMN … DEFAULT <volatile> (rewrite) | Stub | Will add matcher |
| R004 — ADD COLUMN nullable/constant-default on hot table w/o lock_timeout | Implemented (partial) | Size-gated; requires `lock_timeout`; constant-default nuance later |
| R005 — SET NOT NULL w/o validated CHECK | Implemented (partial) | Assumes unsafe on large tables (no catalog check yet) |
| R006 — ADD CHECK w/o NOT VALID | Implemented | Red ≥50k rows |
| R007 — ADD FK w/o NOT VALID | Stub | Will add matcher |
| R008 — ALTER TYPE non-binary-coercible | Stub | Will add matcher |
| R009 — DROP/RENAME | Stub | Will add matcher (yellow) |
| R010 — DDL w/o lock_timeout on hot tables | Implemented (partial) | Applied to common DDL shapes |
| R011 — Live locks advisory | Out of scope |
| R012 — VACUUM FULL / CLUSTER / non-concurrent REINDEX | Implemented | Always red in CI |

## Docs index

- Quick start: check a migration with an estate file — `docs/guides/quick-start-estate-file.md`
- Keep estate fresh with sync-estate — `docs/guides/sync-estate.md`
- Grants for sync-estate — `docs/guides/grants-sync-estate.md`
- MCP: check before apply — `docs/guides/mcp-check-before-apply.md`
- Security notes — `docs/SECURITY.md`
- Development — `docs/DEVELOPMENT.md`
- License — MIT (see `LICENSE`)
 - Nock Team (hosted estate + org policy + audit) — `docs/guides/nock-team.md`

## Stub only: Nock Team (hosted estate + org policy + audit)

Hosted estate distribution (Nock Team) with envelope encryption, organization policy storage, and audit trails — design partners / coming soon. Hosted customers will be able to export estate snapshots and audit logs at any time. No Stripe or signup UI yet. Docs live in this repo (`README.md` and `docs/`).

## License

MIT
