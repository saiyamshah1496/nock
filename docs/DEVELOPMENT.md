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
Also see `docs/design/010-workers-r2-hosting.md` for the Workers + R2 deploy path.

### Running sync-stats locally

```bash
node packages/cli/dist/bin/nock.js sync-stats \
  --database-url "$PG_STATS_URL" \
  --out .nock/stats.json
```

Integration test (optional) reads `NOCK_TEST_DATABASE_URL`. If unset, tests skip the live query.

## Hosted stats for the GitHub Action (Path B+)

- Default API base (Saiyam’s Worker): `https://nock.saiyamshah1496.workers.dev`
- Action inputs on `main`: `stats-api-url`, `stats-api-token`, with `stats-path` as fallback
- Required secrets (names only): `NOCK_STATS_API_TOKEN`, `NOCK_STATS_KEK` (for scheduled pushes)
- See runnable examples under `examples/workflows/`:
  - `nock-action.yml` — Action with hosted stats (Path B+)
  - `nock.yml` — CLI workflow (works without a packaged Action)
  - `nock-sync-push.yml` — scheduled `sync-stats` + push to hosted API

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

## Store selection (local vs R2)

- Default (tests/local): `NOCK_STATS_STORE=file` (or unset) → filesystem at `data/stats/` (override with `NOCK_STATS_STORE_DIR`).
- R2 (Cloudflare): set `NOCK_STATS_STORE=r2` and provide:
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  - Works in both Node and Workers via S3‑compatible HTTPS + SigV4 (`aws4fetch`).

## Workers deploy quickstart

```bash
pnpm -r build
cd packages/api
cp wrangler.toml.example wrangler.toml
# Put secrets
npx wrangler secret put NOCK_STATS_API_TOKEN
npx wrangler secret put NOCK_STATS_KEK
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
# Optional: set vars in wrangler.toml [vars]
npx wrangler deploy
```

## D1 for org policy + audit (Team)

Workers uses Cloudflare D1 to store versioned policies and append-only audit rows.

- Create a D1 database in the Cloudflare dashboard (or via `wrangler d1 create`).
- Bind it in `packages/api/wrangler.toml`:

```toml
[[d1_databases]]
binding = "NOCK_D1"
database_name = "nock-team"
database_id = "00000000-0000-0000-0000-000000000000" # replace with real
migrations_dir = "d1/migrations"
```

- Run migrations:
```bash
cd packages/api
npx wrangler d1 migrations apply NOCK_D1
```

- Vars/secrets:
  - Reuse `NOCK_STATS_API_TOKEN` bearer for policy/audit v1.
  - Optional: `NOCK_AUDIT_RETENTION_DAYS` (default 30).

## CI

PR CI runs on GitHub Actions with:
- Node 20 via `actions/setup-node@v4` (pnpm cache enabled)
- `pnpm install --frozen-lockfile`
- `pnpm -r build` (workspace packages)
- `pnpm test` (vitest)

No deploy in CI. Tests pass without R2/Cloudflare secrets; any online integrations are skipped if env is unset.

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

