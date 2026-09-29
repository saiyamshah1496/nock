# Flyway — install and migration path

Estate‑aware approve/block for Postgres DDL. Same verdict in CLI, GitHub Action, and MCP. Never applies migrations.

## Where Flyway keeps scripts
- Typical directory: `db/migration/` (many Java projects keep this under `src/main/resources/db/migration/`)
- If you configured custom `locations`, point Nock at that on‑disk path in your repo

## Point the Action at your Flyway migrations
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
          migration-path: "db/migration/"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Notes
- If your scripts live under `src/main/resources/db/migration/`, set that full path.

## Footguns (Flyway)
- Prefer one change per script for clarity; versioned files make it easy to isolate risky ops
- `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Do not mix it with transactional statements in the same script. Keep it as a single‑statement script that runs outside a transaction (consult Flyway docs for how your setup executes such scripts), and set any `lock_timeout` separately.

