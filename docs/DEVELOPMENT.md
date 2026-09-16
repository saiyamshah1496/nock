# Development guide

Senior-staff quickstart for contributing to Nock Phase 1.

## Repo map

```
.
├─ packages/
│  ├─ core/      # @nock/core — parse → classify → rules → VerdictV1 (matchers live here)
│  ├─ cli/       # @nock/cli  — bin `nock` (commander)
│  ├─ mcp/       # @nock/mcp  — local MCP server tools + parity tests
│  ├─ action/    # @nock/action — GitHub Action runner + comment renderer
│  ├─ api/       # @nock/api — thin hosted stats API (Path B+)
│  └─ secure-stats/ # @nock/secure-stats — AES-GCM envelope utils shared by CLI/API
├─ fixtures/     # Golden SQL + stats snapshots used by tests
├─ policy.default.yml  # Default policy pack (thresholds only, no marketplace)
├─ docs/design/  # 000–008 design notes
└─ README.md
```

## Prerequisites

- Node 20+ (Action target is Node 20)
- corepack enabled, pnpm installed:

```bash
corepack enable
```

## Install / build / test

```bash
pnpm install
pnpm build
pnpm test
```

Notes:
- Root `package.json` wires `"test": "vitest run"`.
- Use `pnpm -r build` to build all workspaces (root `pnpm build` already does that).

## Run the CLI locally

Two easy ways after building:

1) Direct node path
```bash
node packages/cli/dist/bin/nock.js check \
  --sql fixtures/railway_oct.sql \
  --stats fixtures/stats_billion.json \
  --format json
```

2) With pnpm filter exec
```bash
pnpm --filter @nock/cli exec node dist/bin/nock.js \
  check --sql fixtures/railway_oct.sql --stats fixtures/stats_billion.json --format json
```

Exit codes: 0 pass, 1 warn-only (yellow when `fail_on: yellow`), 2 fail.

## Estate / stats explained

Nock’s engine joins migration statements to an estate snapshot (`stats.json`) with table sizes and version:

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000, "relation_bytes": 890000000000, "total_bytes": 1120000000000 }
  ]
}
```

Path A supports a paste/file path: point `--stats` to a local file (or our fixtures).
Path B is available: `nock sync-stats --database-url $PG_URL --out .nock/stats.json` queries a replica with a stats-only role and writes the same shape.
Path C (hosted pull) is future opt‑in only.

Illustrative SQL used by `sync-stats` (no table row data; only catalog/stats):

```sql
SELECT
  current_setting('server_version') AS pg_version,
  n.nspname AS schema,
  c.relname AS name,
  c.oid AS relid,
  s.n_live_tup,
  s.n_dead_tup,
  s.n_tup_ins,
  s.n_tup_upd,
  s.n_tup_del,
  s.seq_scan,
  s.idx_scan,
  s.last_analyze,
  s.last_autoanalyze,
  pg_relation_size(c.oid) AS relation_bytes,
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY s.n_live_tup DESC NULLS LAST;
```

This repo now includes Path B (sync) and Path B+ (hosted stats API). See `docs/design/008-sync-stats.md` (sync) and `docs/design/009-hosted-stats-api.md` (API), plus `docs/grants-stats-role.md`.

### Running sync-stats locally

```bash
node packages/cli/dist/bin/nock.js sync-stats \
  --database-url "$PG_STATS_URL" \
  --out .nock/stats.json
```

Integration test (optional) reads `NOCK_TEST_DATABASE_URL`. If unset, tests skip the live query.

## How to add a rule

Phase 1 keeps shape matchers in `packages/core/src/index.ts`.

1) Add a matcher function (e.g., `isAddForeignKeyWithoutNotValid`) that:
   - strips comments, normalizes whitespace
   - extracts target table(s)
2) Integrate it in `check(...)` with:
   - lock taxonomy (e.g., ACCESS EXCLUSIVE / SHARE / SUE / SRE)
   - policy thresholds (add keys to `policy.default.yml`)
   - size gates using `n_live_tup`
   - remediation SQL where applicable
3) Add fixtures under `fixtures/` (SQL + reuse or add a stats JSON).
4) Add a vitest under `packages/core/test/` that asserts:
   - violation id / severity
   - final verdict (pass/fail)
5) If the rule affects lock-timeout policy, consider adding/expanding R010 gates.

Tip: Unknown DDL must remain YELLOW (never silent green).

## How to add a fixture

- Place a concise `.sql` under `fixtures/` (one or a few statements).
- Reuse `fixtures/stats_billion.json` for large-table shapes or add a new `stats_*.json` if needed.
- Reference it from tests with `join(__dirname, "../../../fixtures/...")`.

## Golden parity (CLI ≡ MCP)

- The same inputs must produce identical verdict JSON via:
  - CLI: `nock check --format json`
  - MCP: `check_before_apply` (local file paths)
- See tests:
  - `packages/cli/test/cli.golden.test.ts`
  - `packages/mcp/test/mcp.golden.test.ts`

## What not to commit

- Never commit: `node_modules/`, `**/node_modules/`, `dist/`, `**/dist/`, `coverage/`, `.turbo/`, `*.tsbuildinfo`, `.DS_Store`
- Keep: `pnpm-lock.yaml`

## Design notes

Read these before expanding scope:
- `docs/design/000-repo-hosting.md`
- `docs/design/001-parser.md`
- `docs/design/002-verdict-schema.md`
- `docs/design/003-rule-engine.md`
- `docs/design/004-cli.md`
- `docs/design/005-action-pr-comment.md`
- `docs/design/006-mcp-surface.md`
- `docs/design/007-gitignore-and-fixtures.md`

