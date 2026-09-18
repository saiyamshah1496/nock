# Keep estate fresh with sync-estate

Goal: generate `.nock/estate.json` from your Postgres replica on your own GitHub runner (no hosted service). Then use that file in PR checks.

You’ll do this once and schedule it:
1. Create a least‑privilege read‑only role (prefer a read replica)
2. Add a repo secret `PG_ESTATE_URL`
3. Run `nock sync-estate` to write `.nock/estate.json`
4. Add a scheduled workflow to refresh the file or upload it as an artifact
5. Run the PR check that reads `.nock/estate.json`

CLI ≡ Action ≡ MCP — same verdict surface; this guide uses CLI in workflows for simplicity.

On your side — checklist (to get catalogue into PR checks)
- Create/verify a least‑privilege read‑only role with catalogue grants. See `docs/guides/grants-sync-estate.md`. Phase‑1 catalogue reads `pg_attribute`, `pg_constraint`, `pg_index` in addition to sizes — not just stats.
- Prefer a read‑replica; store its DSN in a repo secret `PG_ESTATE_URL`.
- Upgrade to CLI 0.1.4+ (older CLI won’t emit `columns[]`/`constraints[]`/`indexes[]`).
- Re‑run `sync-estate` so `.nock/estate.json` contains the new catalogue sections (or present‑but‑empty `[]` when none).
- Make the estate available to PR checks: commit `.nock/estate.json`, download a recent artifact at job start, or (Team) use `--push-url` after sync.
- Keep it fresh: re‑run/schedule sync. When catalogue sections are omitted, catalogue‑aware rules fail‑closed (e.g. R005/R017 softens/suppresses only when catalogue is present).

What sync-estate captures (catalogue overview):
- Table sizes and version metadata
- Table shape signals on each entry: relkind and replica_identity
- Additive catalogue sections:
  - columns[]: not_null, type_name, presence-only has_default (never default SQL text)
  - constraints[]: kind (check|fk|pk|unique|exclude|...), validated, columns[], supporting_index?
  - indexes[]: unique, primary, valid, ready, immediate, columns[], replica_identity?
Omit vs empty: an omitted section key means “catalogue absent” (fail‑closed for catalogue‑aware rules); a present‑but‑empty [] means “synced; none found”.

### In this repo’s CI

This repository runs a self‑contained integration that proves the “sync‑estate → check” loop against a real Postgres service container. See `/.github/workflows/ci.yml` job `estate-sync-integration` for a complete example:
- Boots Postgres as a service and waits for health
- Seeds a “hot” table and a tiny table (`fixtures/ci-estate/seed.sql`)
- Runs `nock sync-estate` to write `.nock/estate.json`
- Checks one SQL that should RED on the hot table and one that should PASS on the tiny table

## 1) Grants for a read‑only role

Use a dedicated role that can read catalog/statistics only — not table rows.
- See `docs/guides/grants-sync-estate.md` for SQL you can adapt
- Prefer connecting to a read replica
- Managed PGs often require `?sslmode=require` on the connection URL

## 2) Add the database URL secret

In your repo: Settings → Secrets and variables → Actions → New secret
- Name: `PG_ESTATE_URL`
- Value: Postgres DSN for your read‑only role, e.g. `postgres://nock_estate:****@replica.example.com:5432/appdb?sslmode=require`

## 3) Write `.nock/estate.json` on your runner

Add a job that runs `sync-estate` and saves the estate file:
```yaml
name: Nock estate sync (free)
on:
  schedule: [{ cron: "0 */6 * * *" }]
  workflow_dispatch: {}
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - name: Run sync-estate
        env:
          PG_ESTATE_URL: ${{ secrets.PG_ESTATE_URL }}
        run: |
          mkdir -p .nock
          npx @nockhq/cli@0.1.4 sync-estate \
            --database-url "$PG_ESTATE_URL" \
            --out .nock/estate.json
      - name: Upload estate artifact (optional)
        uses: actions/upload-artifact@v4
        with:
          name: nock-estate
          path: .nock/estate.json
          retention-days: 3
```

Note for monorepo contributors: you can continue to use the workspace binary (e.g. `node packages/cli/dist/bin/nock.js`) when developing inside this repo.

Tips
- Keep `.nock/estate.json` in the repo (commit) or publish it as an artifact.
- Estate contains Postgres sizes/version and a governance catalogue (columns, constraints, indexes) — no row data and no SQL/expressions. We never store default expressions, CHECK/index predicates, or generated expressions.

## 4) PR check that uses `.nock/estate.json`

Use a workflow that runs the CLI against your migration files and the estate file:
- See `examples/workflows/nock.yml` (CLI workflow)
- Or `examples/workflows/nock-action.yml` if you prefer the Action; ensure it points to `estate-path: .nock/estate.json`

CLI example (excerpt)
```yaml
name: Nock — Postgres migration safety (CLI)
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
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - name: Run Nock check (CLI)
        run: |
          npx @nockhq/cli@0.1.4 check \
            --sql "migrations/001.sql" \
            --estate ".nock/estate.json" \
            --policy "policy.default.yml" \
            --fail-on "red" \
            --format "json"
```

That’s it — no hosted service required.

See also
- `examples/workflows/nock-sync-push.yml` shows an optional “push to hosted estate API (Nock Team)” job.
- `docs/guides/quick-start-estate-file.md` for a zero‑DB, paste/file quickstart.

