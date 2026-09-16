# Nock

Pattern linters catch shapes. Nock stops merges when staging lies — using your table sizes, Postgres lock classes, and `lock_timeout` policy — in CI and via MCP.

## Phase 1 wedge (what works)

- pnpm monorepo with `@nock/core`, `@nock/cli`, `@nock/mcp`, `@nock/action`
- CLI: `nock check --sql fixtures/railway_oct.sql --stats fixtures/stats_billion.json --format json`
- Rules: R001 (non-concurrent CREATE INDEX) + R010 (require lock_timeout on hot tables) implemented; unknown DDL → yellow
- Fixtures: Railway-shaped SQL + stats with `sessions ≈ 1.04B`
- GitHub Action (file stats path) + PR comment scaffold
- MCP: `check_before_apply` (local stats/policy path)

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
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## MCP one-liner (local)

See `@nock/mcp` — provides `check_before_apply`, `explain_lock`, `list_rules`. Golden tests ensure CLI JSON equals MCP JSON on identical inputs.

## Policy

Default policy lives at `policy.default.yml` — a single default pack with thresholds only (not a pack marketplace in Phase 1). Unknown DDL is never silent green: it becomes YELLOW.

## For developers

See `docs/DEVELOPMENT.md` for setup, repo map, running the CLI, adding rules/fixtures, parity expectations, and git hygiene.

## Docs

Design notes live under `docs/design/`. Teardown doc stub: `docs/teardown-railway-locks.md`.

## License

MIT
