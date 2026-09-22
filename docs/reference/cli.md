# CLI reference

Use the published CLI directly with npx:

```bash
npx @nockhq/cli@latest --help
```

Common commands:

- Check a migration against an estate file:

```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --format json
```

- Sync an estate JSON from a read‑only Postgres role (prefer a replica):

```bash
npx @nockhq/cli@latest sync-estate \
  --database-url \"$DATABASE_URL\" \
  --out .nock/estate.json
```

- Single‑shot live DATABASE_URL check (refresh estate in‑memory, do not write a file):

```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --database-url \"$DATABASE_URL\" \
  --format json
```

Notes:
- The same inputs yield the same verdict JSON across CLI, GitHub Actions, and MCP.
- Nock never applies migrations.

Related:
- Verdict JSON
- Estate schema

