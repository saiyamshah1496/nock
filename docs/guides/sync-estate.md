# Keep estate fresh with sync-estate

Goal: generate `.nock/estate.json` from your Postgres replica on your own GitHub runner (no hosted service). Then use that file in PR checks.

You’ll do this once and schedule it:
1. Create a least‑privilege read‑only role (prefer a read replica)
2. Add a repo secret `PG_ESTATE_URL`
3. Run `nock sync-estate` to write `.nock/estate.json`
4. Add a scheduled workflow to refresh the file or upload it as an artifact
5. Run the PR check that reads `.nock/estate.json`

CLI ≡ Action ≡ MCP — same verdict surface; this guide uses CLI in workflows for simplicity.

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
        with: { node-version: 20, cache: 'pnpm' }
      - run: corepack enable && pnpm install --frozen-lockfile && pnpm -r build
      - name: Run sync-estate
        env:
          PG_ESTATE_URL: ${{ secrets.PG_ESTATE_URL }}
        run: |
          mkdir -p .nock
          node packages/cli/dist/bin/nock.js sync-estate \
            --database-url "$PG_ESTATE_URL" \
            --out .nock/estate.json
      - name: Upload estate artifact (optional)
        uses: actions/upload-artifact@v4
        with:
          name: nock-estate
          path: .nock/estate.json
          retention-days: 3
```

Tips
- Keep `.nock/estate.json` in the repo (commit) or publish it as an artifact.
- Estate contains sizes and version only; no row data or secrets.

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
        with: { node-version: 20, cache: 'pnpm' }
      - run: corepack enable && pnpm install --frozen-lockfile && pnpm -r build
      - name: Run Nock check (CLI)
        run: |
          node packages/cli/dist/bin/nock.js check \
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

