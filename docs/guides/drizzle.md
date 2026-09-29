# Drizzle Kit — install and migration path

Estate‑aware approve/block for Postgres DDL. Same verdict in CLI, GitHub Action, and MCP. Never applies migrations.

## Where Drizzle writes SQL
- Default output folder is typically `drizzle/`
- If you set a custom `out` in `drizzle.config.*`, point Nock at that folder

## Point the Action at your Drizzle migrations
Minimal GitHub Actions example using the Marketplace Action:

```yaml
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: saiyamshah1496/nock-action@v0.1.9
        with:
          migration-path: "drizzle/"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Notes
- If your Drizzle `out` folder differs (e.g., `db/migrations`), set `migration-path` to that directory.

## Footgun to avoid (Drizzle)
- Postgres rejects `CREATE INDEX CONCURRENTLY` inside a transaction. If your generated migration batches multiple statements or is transaction‑wrapped, isolate any CONCURRENTLY operations into their own single‑statement file and ensure they run outside a transaction. Keep any `SET lock_timeout` in a separate step/file.

