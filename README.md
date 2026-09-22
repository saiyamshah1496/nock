# Nock

> Estate-aware approve/block for Postgres DDL.

Same verdict in CLI, CI, and Cursor MCP. Never applies migrations.

[![npm](https://img.shields.io/npm/v/%40nockhq%2Fcli.svg)](https://www.npmjs.com/package/@nockhq/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why Nock
- Checks your proposed DDL against an **estate** — a snapshot of your table sizes plus catalogue facts (columns, constraints, indexes) — so it approves or blocks based on *your* data, not generic SQL patterns
- **Check-only**: never applies migrations and never writes to your database
- Returns the **same JSON verdict** from the CLI, GitHub Actions, and Cursor MCP
- Exit codes: `0` pass · `1` warnings only · `2` fail (blocking)

## Quick start (golden path)
An **estate** is a small JSON snapshot of your Postgres table sizes and catalogue facts (columns, constraints, indexes)—not a dump of row data—that Nock uses to approve or block DDL for your database. Details: [Estate schema](docs/reference/estate-schema.md).

1) Get an estate (pick one)
- Bring your own estate: commit `.nock/estate.json`
- Sync estate yourself: `npx @nockhq/cli@latest sync-estate --database-url "$DATABASE_URL" --out .nock/estate.json`
- [Live DATABASE_URL check](docs/guides/live-estate-database-url.md): omit `--estate`, pass `--database-url`

2) Check
```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --format json
```

3) Wire the gate — same command in Actions or MCP `check_before_apply`. Exit: 0 pass · 1 warn · 2 fail.

Example verdict (truncated)
```json
{ "verdict": "fail", "violations": [ { "rule_id": "R001", "severity": "red" } ] }
```

## Add to CI (GitHub Action)
Preferred: use the published Action from this repo’s `packages/action` subdirectory, pinned to a tag:

```yaml
name: Nock — Postgres migration safety (Action)
on:
  pull_request:
    paths: ['migrations/**', '.nock/**']
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - name: Run Nock check (Action)
        uses: saiyamshah1496/nock/packages/action@v0.1.9
        with:
          migration-path: migrations/
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Notes:
- This Action is intentionally published from a subdirectory; GitHub Marketplace listing requires a dedicated public repo with a root `action.yml` (follow‑up item).
- You can also test a PR branch by pinning a commit SHA in `uses: owner/repo/path@<sha>`.

Alternative (CLI):
Copy-paste into `.github/workflows/nock.yml`:

```yaml
name: Nock — Postgres migration safety (CLI)
on:
  pull_request:
    paths: ['migrations/**', '.nock/**']
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - name: Run Nock check (CLI)
        run: |
          npx @nockhq/cli@latest check \
            --sql "migrations/001.sql" \
            --estate ".nock/estate.json" \
            --policy "policy.default.yml" \
            --fail-on "red" \
            --format "json" | tee nock-verdict.json
```

See more in [examples/workflows/nock.yml](examples/workflows/nock.yml) and [examples/workflows/nock-action.yml](examples/workflows/nock-action.yml).

## Add to Cursor (MCP)
- Install server via npx:
  ```json
  { "mcpServers": { "nock": { "command": "npx", "args": ["-y", "@nockhq/mcp@latest"] } } }
  ```
- Call `check_before_apply` with either:
  - `estatePath: ".nock/estate.json"` (file)
  - or `databaseUrl: "postgres://..."` (live DATABASE_URL check)
- Guide: [docs/guides/mcp-check-before-apply.md](docs/guides/mcp-check-before-apply.md)

## Not Squawk, not Atlas
> Not Squawk, not Atlas. Squawk lints migration shapes without knowing your table sizes. Atlas plans and applies schema changes. Nock does neither: it takes your DDL plus an estate snapshot (or a live read-only `DATABASE_URL`) and returns approve or block for CI and agents—lock risk on your data—without ever applying SQL.

## Free vs Team

**Free — one estate, DIY**
Bring your own estate file, sync estate yourself, or run a live `DATABASE_URL` check on *your* runner. Staging + production means two checks or a CI matrix you own. Nock does **not** host multi-estate packs on Free.

**Team — estate packs**
Hosted staging / production / tenant estates under one org, plus org policy, audit, and export. Same approve/block engine as Free — ops convenience when you outgrow a single estate file in CI.

## Docs
- [Getting started](docs/guides/quick-start-estate-file.md)
- [Estate (sync estate yourself)](docs/guides/sync-estate.md)
- [Live DATABASE_URL check](docs/guides/live-estate-database-url.md)
- [CI](examples/workflows/nock.yml)
- [MCP](docs/guides/mcp-check-before-apply.md)
- [Grants](docs/guides/grants-sync-estate.md)
- Reference: [CLI](docs/reference/cli.md) · [Rules](docs/reference/rules.md) · [Verdict JSON](docs/reference/verdict-json.md) · [Estate schema](docs/reference/estate-schema.md)

---

## Security
- No row data is read or processed; only catalogue (columns, constraints, indexes) and table sizes
- Your database URL never leaves your runner in Free mode
- Prefer read‑only roles and replicas for `sync-estate` or live checks
See [docs/SECURITY.md](docs/SECURITY.md).

## Contributing
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License
MIT
