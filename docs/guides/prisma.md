# Prisma Migrate — install and migration path

Estate‑aware approve/block for Postgres DDL. Same verdict in CLI, GitHub Action, and MCP. Never applies migrations.

## Where Prisma writes SQL
- Generated migration files land under `prisma/migrations/**/migration.sql`

## Point the Action at your Prisma migrations
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
          migration-path: "prisma/migrations/**/migration.sql"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Notes
- You can also pass the directory `prisma/migrations/` if your runner resolves nested files; the glob above matches the canonical `migration.sql` locations.
- Add `estate-path` and `policy-path` if you keep those in non‑default locations.

## Footguns (Prisma) — brief
- Create Index Concurrently (CIC) must be a single statement and not wrapped in a transaction — see details: [`./prisma-migrations.md#concurrent-ddl-cannot-run-in-a-transaction`](./prisma-migrations.md#concurrent-ddl-cannot-run-in-a-transaction)
- If Prisma would wrap multiple statements, disable the transaction for that migration file — see: [`./prisma-migrations.md#concurrent-ddl-cannot-run-in-a-transaction`](./prisma-migrations.md#concurrent-ddl-cannot-run-in-a-transaction)
- Don’t combine `SET lock_timeout` and the CIC in the same Prisma migration — why: [`./prisma-migrations.md#lock_timeout-before-cic`](./prisma-migrations.md#lock_timeout-before-cic)

## Optional — one‑liner CLI check
```bash
npx @nockhq/cli@latest check \
  --sql "prisma/migrations/20240101010101_add_index/migration.sql" \
  --estate ".nock/estate.json" \
  --policy "policy.default.yml" \
  --fail-on "red" \
  --format "json"
```

