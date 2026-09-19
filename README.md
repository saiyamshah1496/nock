# Nock

Nock gates risky Postgres migrations before they merge.
It checks your DDL against an estate snapshot (table sizes and governance facts — columns, constraints, indexes) and policy — lock class, `lock_timeout`, hot‑table risk — and returns approve or block.
Pattern linters catch shapes. Nock catches “this is unsafe on your data.”
Nock never applies migrations. CLI ≡ Action ≡ MCP — the same verdict JSON for the same inputs.

## Install
 
Use directly with npx (recommended):

```bash
npx @nockhq/cli@latest --help
# or run a check
npx @nockhq/cli@latest check --sql migrations/001.sql --estate .nock/estate.json --format json
```

Or install globally:

```bash
npm i -g @nockhq/cli
nock --help
```

From source (developers):

```bash
corepack enable
pnpm install
pnpm build
```

## What is an estate?

An estate is a small JSON snapshot of your Postgres tables’ sizes and governance facts (columns, constraints, indexes) that Nock uses to reason about locks and risk on your actual data. It is not a dump — no row contents, no passwords, and no stored SQL/expressions.

Minimal shape (Phase‑1 catalogue; additive sections):

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000, "relkind": "r", "replica_identity": "d" }
  ],
  "columns": [
    { "schema": "public", "table": "sessions", "column": "id", "not_null": true, "type_name": "bigint" },
    { "schema": "public", "table": "sessions", "column": "archived_at", "not_null": false, "type_name": "timestamptz", "has_default": false }
  ],
  "constraints": [
    { "schema": "public", "table": "sessions", "name": "sessions_pkey", "kind": "pk", "validated": true, "columns": ["id"], "supporting_index": "sessions_pkey" }
  ],
  "indexes": [
    { "schema": "public", "table": "sessions", "name": "sessions_pkey", "unique": true, "primary": true, "valid": true, "ready": true, "live": true, "immediate": true, "columns": ["id"], "replica_identity": true }
  ]
}
```

Omit vs [] semantics: omitting a section key means “catalogue absent” (catalogue‑aware rules fail‑closed); a present‑but‑empty `[]` means “synced; none found”.

## Quick start: check a migration with an estate file

```bash
npx @nockhq/cli@latest check \
  --sql fixtures/railway_oct.sql \
  --estate fixtures/estate_billion.json \
  --format json
```

Exit codes: 0 pass, 1 warn-only (yellow when fail_on=yellow), 2 fail.

Two ways to provide an estate (plus an experimental live-refresh):
- Bring your own estate — paste/commit `.nock/estate.json`: see [`docs/guides/quick-start-estate-file.md`](docs/guides/quick-start-estate-file.md)
- Sync estate yourself — run `nock sync-estate` on your runner: see [`docs/guides/sync-estate.md`](docs/guides/sync-estate.md)
- Experimental (hackathon Path C thin): pass `--database-url` (or set `DATABASE_URL` / `SUPABASE_DB_URL`) to have `nock check` refresh the estate from Postgres on the fly, then evaluate:
  ```bash
  npx @nockhq/cli@latest check \
    --sql examples/hackathon-supabase/bad.sql \
    --database-url "$DATABASE_URL" \
    --format json
  ```
  Prefer a read‑only role and a replica. No row data is read; only Phase‑1 catalogue (columns, constraints, indexes) and table sizes.

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
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000, "relkind": "r", "replica_identity": "d" }
  ],
  "columns": [],
  "constraints": [],
  "indexes": []
}
```

Command

```bash
npx @nockhq/cli@latest check --sql fixtures/railway_oct.sql --estate fixtures/estate_billion.json --format json
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

Generate `.nock/estate.json` with a read‑only role (prefer a replica) on your own GitHub runner and use it in PR checks. Guide: [`docs/guides/sync-estate.md`](docs/guides/sync-estate.md)

For hackathon demos, you can also skip writing a file and run a single-shot check with `--database-url` or env `DATABASE_URL`/`SUPABASE_DB_URL`. This is experimental and not a replacement for the BYO/self‑sync path.

## Add Nock to GitHub Actions

See [`packages/action/action.yml`](packages/action/action.yml) and copy into [`.github/workflows/nock.yml`](.github/workflows/nock.yml):

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
        uses: ./.github/actions/nock  # example-only; prefer the CLI workflow below if not publishing an Action yet
        with:
          migration-path: migrations/
          # Optional: download hosted estate to file (Team)
          # estate-api-url: https://example.workers.dev/v1/estate/my-repo
          # estate-api-token: ${{ secrets.NOCK_TEAM_API_TOKEN }}
          # File fallback (OSS/local)
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Prefer the CLI workflow in [`examples/workflows/nock.yml`](examples/workflows/nock.yml) if you’re not using a published Action yet — it runs `npx @nockhq/cli` directly on your runner. Or install the Nock DDL Gate GitHub App to enforce checks on pull requests: [Nock DDL Gate](https://github.com/apps/nock-ddl-gate).

## How to read results

- Green: safe to merge
- Yellow: risky or unknown pattern; warn by default, or fail when `fail-on: yellow`
- Red: unsafe; fix or defer until off-peak or with mitigations
- Exit codes: 0 pass, 1 warn-only (when `fail-on: yellow`), 2 fail

## Grants for sync-estate

Create a least‑privilege read‑only role that can run the catalogue query (no row data) and prefer connecting to a replica. Guide: [`docs/guides/grants-sync-estate.md`](docs/guides/grants-sync-estate.md)

## MCP: check before apply

See `@nockhq/mcp` — provides `check_before_apply`, `explain_lock`, `list_rules`. Golden tests ensure CLI JSON equals MCP JSON on identical inputs. Guide: [`docs/guides/mcp-check-before-apply.md`](docs/guides/mcp-check-before-apply.md). Use either `npx @nockhq/mcp` (bin `nock-mcp`) or the from‑source config in the guide.

## Rules

| Rule | Status | Notes |
|------|--------|-------|
| R001 — CREATE INDEX w/o CONCURRENTLY | Implemented | Lock mode SHARE; red ≥10k rows |
| R002 — CIC inside transaction | Implemented | Concurrent DDL cannot run inside explicit txn |
| R003 — ADD COLUMN … DEFAULT <volatile> (rewrite) | Implemented | Size-gated rewrite on volatile DEFAULT; do not red now() |
| R004 — ADD COLUMN nullable/constant-default on hot table w/o lock_timeout | Implemented (partial) | Size-gated; requires `lock_timeout`; constant-default nuance later |
| R005 — SET NOT NULL w/o validated CHECK | Implemented (catalogue-aware) | Red ≥100k; soften to yellow when fresh catalogue shows column already NOT NULL or a validated CHECK covering it. Fail‑closed when catalogue sections are omitted; present‑but‑empty arrays don’t match. |
| R006 — ADD CHECK w/o NOT VALID | Implemented | Red ≥50k rows |
| R007 — ADD FK w/o NOT VALID | Implemented (catalogue-aware) | Red ≥100k rows; remediate NOT VALID → VALIDATE. Extra yellow when catalogue present and no supporting index covers the FK child columns (prefix/equal) — remediate with CREATE INDEX CONCURRENTLY on the child columns. Omitted catalogue → today’s R007 only (fail‑closed). |
| R008 — ALTER TYPE non-binary-coercible | Implemented (catalogue-aware) | Yellow unknown; red when clearly rewriting (USING). Widen to text (unbounded) passes. When fresh catalogue is present, soften only true binary-coercible varchar widens relative to `columns[].type_name` — `varchar(n)→varchar(m≥n)` or `varchar(n)→text`. Omitted catalogue → today’s R008 only (fail‑closed). |
| R009 — DROP/RENAME | Implemented (catalogue-aware) | Yellow advisory; includes DROP COLUMN/CONSTRAINT, RENAME COLUMN/TABLE. When fresh catalogue is present: (a) dropping PK/UNIQUE that is the replica identity path (`tables[].replica_identity` = d/i) escalates with a stronger advisory (optional knob to make red); (b) dropping a column that still appears in `constraints[].columns`/`indexes[].columns` escalates with dependency-aware remediation. Omitted catalogue → today’s R009 only (fail‑closed). |
| R010 — DDL w/o lock_timeout on hot tables | Implemented (partial) | Applied to common DDL shapes |
| R011 — Live locks advisory | Out of scope |
| R012 — VACUUM FULL / non-concurrent REINDEX | Implemented | Always red in CI |
| R013 — REFRESH MATERIALIZED VIEW w/o CONCURRENTLY | Implemented | Red ≥10k rows; yellow if unknown size |
| R014 — ATTACH/DETACH PARTITION | Implemented | Yellow/red by size; notes on lock/scan |
| R015 — CIC w/o prior lock_timeout on hot table | Implemented | Yellow/red per size thresholds |
| R016 — Multiple AE DDLs on same hot table w/o lock_timeout | Implemented | Yellow advisory |
| R017 — ADD UNIQUE/PRIMARY KEY w/o USING INDEX | Implemented (catalogue-aware) | Red ≥10k; remediate CIC + USING INDEX. Suppress the red hit when a matching unique/primary, valid/ready/immediate index exists in the fresh catalogue with equal, order‑sensitive `columns[]`. Fail‑closed on omitted catalogue; empty/mismatch/invalid do not suppress. |
| R018 — ADD EXCLUDE constraint | Implemented | Size-gated red/yellow; no NOT VALID path |
| R019 — TRUNCATE on estate table | Implemented | Always red in CI policy |
| R020 — CLUSTER | Implemented | Always red in CI (R012 family) |
| R021 — CIC without explicit index name | Implemented | Yellow advisory |
| R022 — VALIDATE CONSTRAINT on hot table | Implemented | Yellow ≥10k rows; red ≥100k rows; catalogue-aware suppression when the matching constraint is already validated. Fallback to SQL table when constraints section omitted. |
| R023 — Invalid or not-ready index on touched table | Implemented | Default yellow when any `valid=false` or `ready=false` index exists on a table touched by the migration; fail‑closed when indexes section omitted. |

## Docs index

- Quick start: check a migration with an estate file — [`docs/guides/quick-start-estate-file.md`](docs/guides/quick-start-estate-file.md)
- Keep estate fresh with sync-estate — [`docs/guides/sync-estate.md`](docs/guides/sync-estate.md)
- Grants for sync-estate — [`docs/guides/grants-sync-estate.md`](docs/guides/grants-sync-estate.md)
- Estate file path reference — [`docs/guides/estate-path.md`](docs/guides/estate-path.md)
- MCP: check before apply — [`docs/guides/mcp-check-before-apply.md`](docs/guides/mcp-check-before-apply.md)
- Security notes — [`docs/SECURITY.md`](docs/SECURITY.md)
- Development — [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- License — MIT (see [`LICENSE`](LICENSE))
- Nock Team (hosted estate + org policy + audit) — [`docs/guides/nock-team.md`](docs/guides/nock-team.md)
- Nock Team partner setup (design partners) — [`docs/guides/nock-team-partner-setup.md`](docs/guides/nock-team-partner-setup.md)

## Nock Team (hosted estate + org policy + audit + export)

Nock Team thin-slice is live for design partners (invite): hosted estate with envelope encryption, organization policy, audit trails, and export. No Stripe / no self-serve signup yet. For onboarding, see [`docs/guides/nock-team-partner-setup.md`](docs/guides/nock-team-partner-setup.md).

## License

MIT
