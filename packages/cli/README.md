@nockhq/cli — Nock command‑line interface
=========================================

Estate‑aware approve/block for Postgres DDL. Same verdict as the GitHub Action and Cursor MCP. Never applies migrations.

Quick start
-----------

```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --format json
```

Docs
----

- Getting started: [docs/guides/quick-start-estate-file.md](../../docs/guides/quick-start-estate-file.md)
- CLI reference: [docs/reference/cli.md](../../docs/reference/cli.md)
- Live DATABASE_URL check: [docs/guides/live-estate-database-url.md](../../docs/guides/live-estate-database-url.md)

CI integration
--------------

- GitHub Marketplace Action (preferred for CI): `uses: saiyamshah1496/nock-action@v0.1.9` — see listing: [Nock — Estate‑aware Postgres DDL](https://github.com/marketplace/actions/nock-estate-aware-postgres-ddl)

