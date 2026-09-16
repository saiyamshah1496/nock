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

Default policy lives at `policy.default.yml`. Unknown DDL is never silent green: it becomes YELLOW.

## Docs

Design notes live under `docs/design/`. Teardown doc stub: `docs/teardown-railway-locks.md`.

## License

MIT
