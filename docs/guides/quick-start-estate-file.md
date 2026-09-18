# Quick start: check a migration with an estate file

Goal: make Nock reproducible in minutes with no database connection. You provide an estate snapshot JSON file, and Nock checks your migrations locally or in CI.

What you’ll do
- Put an estate file at `.nock/estate.json` (or reuse our fixtures)
- Run `nock check` (CLI) or the GitHub Action
- Treat green/yellow/red as approve/block signals; exit codes are explained below

CLI ≡ Action ≡ MCP — the same verdict JSON either way.

## 1) Get an estate file

Option A — reuse our sample (large tables)
- Copy `fixtures/estate_billion.json` from this repo into your repo as `.nock/estate.json`

Option B — start tiny and edit by hand
- Minimal shape:
```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000, "relation_bytes": 890000000, "total_bytes": 1120000000 }
  ]
}
```

Notes
- “Estate” is table sizes + Postgres version and may include a governance catalogue (columns, constraints, indexes). It never contains row data, default expression text, or CHECK/index expressions.
- You can keep `.nock/estate.json` in the repo (commit) or publish it as a build artifact.
- If you hand‑author an estate: you may omit catalogue sections entirely (fail‑closed for catalogue‑aware rules), or include present‑but‑empty arrays. Prefer pasting real catalogue output from `sync-estate` — don’t invent fake `columns[]`/`constraints[]`/`indexes[]`.

## 2) Run a check locally (CLI)

Run with the published CLI (recommended for strangers):

```bash
## Example using this repo’s fixtures:
npx @nockhq/cli@0.1.4 check \
  --sql fixtures/railway_oct.sql \
  --estate fixtures/estate_billion.json \
  --policy policy.default.yml \
  --fail-on red \
  --format json
```

To check your own repo, point to your migration file(s) and `.nock/estate.json`:

```bash
npx @nockhq/cli@0.1.4 check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --policy policy.default.yml \
  --fail-on red \
  --format json
```

Exit codes
- 0: pass
- 1: warn-only (yellow) when `fail-on` is set to `yellow`
- 2: fail (red)

## 3) Run in CI (GitHub Action or CLI)

You can use the Action or run the CLI in your workflow. See runnable examples:
- `examples/workflows/nock.yml` — CLI workflow (works without a packaged Action)
- `examples/workflows/nock-action.yml` — Action-based (replace the `uses:` path with your published action if needed)

Minimal CLI job (excerpt)
```yaml
name: Nock — Postgres migration safety (CLI)
on:
  pull_request:
    paths: ['migrations/**', '.nock/**']
jobs:
  nock:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Run Nock check (CLI)
        run: |
          npx @nockhq/cli@0.1.4 check \
            --sql migrations/001.sql \
            --estate .nock/estate.json \
            --policy policy.default.yml \
            --fail-on red \
            --format json
```

From this repo (contributors), you can also run the built monorepo binary:

```bash
node packages/cli/dist/bin/nock.js check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --policy policy.default.yml \
  --fail-on red \
  --format json
```

## 4) Approve or block

- Green: safe to merge
- Yellow: risky pattern or unknown DDL; treat as warn unless you set `fail-on: yellow`
- Red: unsafe; fix or defer until off-peak or with stronger mitigations

Next steps
- To generate `.nock/estate.json` from a database on your runner (no hosted service required), see: `docs/guides/sync-estate.md`.

