# Nock

Pattern linters catch shapes. Nock stops merges when staging lies — using your table sizes, Postgres lock classes, and `lock_timeout` policy — in CI and via MCP.

## Phase 1 wedge (what works)

- pnpm monorepo with `@nock/core`, `@nock/cli`, `@nock/mcp`, `@nock/action`
- CLI: `nock check --sql fixtures/railway_oct.sql --stats fixtures/stats_billion.json --format json`
- Rules: R001 (non-concurrent CREATE INDEX) + R010 (require lock_timeout on hot tables) implemented; unknown DDL → yellow
- Fixtures: Railway-shaped SQL + stats with `sessions ≈ 1.04B`
- GitHub Action (file stats path) + PR comment scaffold
- MCP: `check_before_apply` (local stats/policy path)
- Path B sync (Phase 2): `nock sync-stats --database-url $PG_URL --out .nock/stats.json` now available; optional `--push-url` to hosted API (see Path B+).

Out of scope for Phase 1: hosted API, billing, dashboard, apply plane, MySQL, R011 live locks, libpg-query WASM.

## Rule coverage (Phase 1 honesty)

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
| R011 — Live locks advisory | Out of scope | Phase 3 |
| R012 — VACUUM FULL / CLUSTER / non-concurrent REINDEX | Implemented | Always red in CI |

## Quick start

```bash
corepack enable
pnpm install
pnpm build
node packages/cli/dist/bin/nock.js check --sql fixtures/railway_oct.sql --stats fixtures/stats_billion.json --format json
```

Exit codes: 0 pass, 1 warn-only (yellow when fail_on=yellow), 2 fail.

## Estate paths A / B / B+ / C

- Path A — paste/file: commit or artifact `stats.json`; no DB required.
- Path B — customer sync: run `nock sync-stats` on your own runner (prefer replica) to write `stats.json` locally; same schema as fixtures.
- Path B+ — thin hosted stats: optionally push encrypted stats to a tiny API you run; the Action can fetch from it. Local-first; envelope encryption for production; plaintext dev mode for local only. See design `docs/design/009-hosted-stats-api.md` and `docs/design/010-workers-r2-hosting.md` (Cloudflare Workers + R2).
- Path C — hosted pull: future opt‑in only (Team/Business); not built in this PR.

### `nock sync-stats`

```
nock sync-stats --database-url "$PG_STATS_URL" --out .nock/stats.json
# Optional Path B+ push after writing file:
nock sync-stats --database-url "$PG_STATS_URL" --out .nock/stats.json \
  --push-url "http://localhost:8787/v1/stats/my-repo" --token dev
```

Notes:
- Use a read‑only stats role; see `docs/grants-stats-role.md`.
- Managed PG often needs `?sslmode=require` on the URL.
- Optional `--sql-file` allows overriding the default catalogue query later.
- For `--push-url`:
  - In local plaintext dev mode set `NOCK_DEV_PLAINTEXT_STATS=1` (sends raw JSON).
  - Otherwise set `NOCK_STATS_KEK` (base64 32 bytes) to encrypt with AES‑GCM envelope.
  - The API requires `Authorization: Bearer <token>` (MVP).

## GitHub Action example

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
        uses: ./.github/actions/nock  # or your published action
        with:
          migration-path: migrations/
          stats-path: .nock/stats.json
          # Optional Path B+ fetch:
          # stats-api-url: https://api.example.com/v1/stats/my-repo
          # stats-api-token: ${{ secrets.NOCK_STATS_API_TOKEN }}
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Scheduled stats sync (artifact) — example

This job runs every 6h to produce a fresh `stats.json` artifact without committing it. For demo, it uses a fake DSN variable; wire real secrets in your repo.

```yaml
name: Nock stats sync
on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch: {}
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: corepack enable && pnpm install && pnpm -r build
      - name: Run sync-stats
        env:
          PG_STATS_URL: ${{ secrets.PG_STATS_URL }} # provide in repo secrets; use a read-only replica
        run: |
          node packages/cli/dist/bin/nock.js sync-stats \
            --database-url "$PG_STATS_URL" \
            --out .nock/stats.json
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: nock-stats
          path: .nock/stats.json
          retention-days: 3
```

## Run the hosted API locally (Path B+)

Minimal local server with file-backed store and bearer auth.

```bash
# One-time: key for envelope mode
export NOCK_STATS_KEK="$(openssl rand -base64 32)"
export NOCK_STATS_API_TOKEN=dev
# Dev plaintext mode (local only). Omit this to require encryption:
export NOCK_DEV_PLAINTEXT_STATS=1

pnpm -r build
node packages/api/dist/server.js  # listens on :8787
```

Endpoints:
- `POST /v1/stats/:repoId` (bearer required) — plaintext JSON in dev mode; encrypted envelope otherwise
- `GET /v1/stats/:repoId` — returns last-good plaintext JSON

Store location default: `data/stats/` (override with `NOCK_STATS_STORE_DIR`).

## Deploying the thin API to Cloudflare Workers (primary)

See `docs/design/010-workers-r2-hosting.md` and `packages/api/wrangler.toml.example`. High-level:

```bash
pnpm -r build
cd packages/api
# Set vars & secrets via wrangler
npx wrangler secret put NOCK_STATS_API_TOKEN
npx wrangler secret put NOCK_STATS_KEK
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
echo 'NOCK_STATS_STORE="r2"' >> wrangler.toml  # or set as a var
npx wrangler deploy
```

Note: Fly is not required. Workers + R2 is the default hosting path.

## MCP one-liner (local)

See `@nock/mcp` — provides `check_before_apply`, `explain_lock`, `list_rules`. Golden tests ensure CLI JSON equals MCP JSON on identical inputs.

## Policy

Default policy lives at `policy.default.yml` — a single default pack with thresholds only (not a pack marketplace in Phase 1). Unknown DDL is never silent green: it becomes YELLOW.

## For developers

See `docs/DEVELOPMENT.md` for setup, repo map, running the CLI, adding rules/fixtures, parity expectations, and git hygiene.

## Docs

Design notes live under `docs/design/` (see `008-sync-stats.md`, `009-hosted-stats-api.md`). GRANTs guidance in `docs/grants-stats-role.md`. Teardown doc stub: `docs/teardown-railway-locks.md`.

## License

MIT
