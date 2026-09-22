# Live DATABASE_URL check (CLI + MCP)

Use a Postgres connection string (`DATABASE_URL`) to refresh an estate snapshot in‑memory just before evaluating your DDL. The verdict JSON is identical across CLI and MCP. No row data is read; only catalogue and sizes. Nock never applies migrations.

This deep guide shows how to run a live `DATABASE_URL` check that refreshes an estate directly from Postgres just before running a check.

Recommendations
- Prefer a read‑only role and a replica for live checks.
- Works alongside “Bring your own estate” and “Sync estate yourself”. CLI ≡ MCP verdicts for the same inputs and policy.

## Prerequisites

- A Postgres connection string in `DATABASE_URL`. Prefer a read‑only role and a replica.
- Node 20+.

## Seed a hot-ish sessions table (optional)

If your database doesn’t already have a sizable `public.sessions` table:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f examples/live-estate-database-url/seed.sql
```

This creates `public.sessions` and inserts ~1.2M rows.

## CLI: red → green

Bad (non‑concurrent index, no lock_timeout) — expect fail with `R001` and `R010`:

```bash
npx @nockhq/cli@latest check \
  --sql examples/live-estate-database-url/bad.sql \
  --database-url "$DATABASE_URL" \
  --format json --fail-on red
```

Good (lock_timeout + CONCURRENTLY) — expect pass:

```bash
npx @nockhq/cli@latest check \
  --sql examples/live-estate-database-url/good.sql \
  --database-url "$DATABASE_URL" \
  --format json --fail-on red
```

## MCP: check_before_apply with live refresh

Configure MCP to use `@nockhq/mcp@latest` and provide `DATABASE_URL` via env:

```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nockhq/mcp@latest"],
      "env": {
        "DATABASE_URL": "postgres://user:pass@host:5432/db"
      }
    }
  }
}
```

Call the tool with your SQL — the server will refresh the estate then evaluate:

```json
{
  "toolName": "nock.check_before_apply",
  "args": {
    "sql": "CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);"
  }
}
```

## Short talk track

1) “Nock gates risky Postgres DDL based on your estate — sizes + catalogue. I’ll use a `DATABASE_URL` to refresh the estate just‑in‑time before checking a migration.”  
2) “Bad path: non‑concurrent index on hot `sessions` with no `lock_timeout`.” → red (`R001`, `R010`).  
3) “Good path: set `lock_timeout` and use `CONCURRENTLY`.” → pass.  
4) “For CI, keep estate fresh with `nock sync‑estate` (BYO/self‑sync). Team hosted estate + push is separate and not part of this PR.”  

## What this reads from Postgres (catalogue only)

The live check refreshes the same catalogue/stats as `sync-estate` (no row data):
- Tables: joins `pg_class` + `pg_namespace` + `pg_stat_user_tables`, plus size functions (e.g., `pg_relation_size`, `pg_total_relation_size`) to collect table names, schemas, live row estimates, and sizes.
- Tables: may also read write counters `n_tup_ins`/`n_tup_upd`/`n_tup_del` (absolute counts since stats reset) when available.
- Columns: from `pg_attribute` to list column names and nullability; we record the presence of a default via a boolean flag only — we do not store default expression text.
- Constraints: from `pg_constraint` to list keys (PK/UNIQUE/FK/CHECK) and validation status; CHECK expression text is not stored.
- Indexes: from `pg_index` (and related name lookups) to capture index names and which columns they cover. Omit `columns` when unknown or expression‑only; INCLUDE columns are ignored.
- Explicit: Nock never SELECTs application table row data.

Grants for the least‑privilege read‑only role are documented here: [`docs/guides/grants-sync-estate.md`](grants-sync-estate.md).
