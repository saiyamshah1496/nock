# Path C thin: live estate from DATABASE_URL (CLI + MCP)

Nock is an estate‑aware Postgres migration safety gate — not a pattern linter and not a proxy. It evaluates DDL against your estate (sizes + Phase‑1 catalogue facts: columns, constraints, indexes) and a policy to approve or block before merge.

This guide shows a lasting, thin Path C slice that refreshes an estate snapshot directly from Postgres using a `DATABASE_URL`/`SUPABASE_DB_URL` just before running a check. No row data is read or stored.

Notes
- FREE forever: just‑in‑time catalogue refresh (no file write); same read‑only grants as `sync-estate`.
- Works alongside the free BYO estate file and `nock sync-estate` paths.
- CLI ≡ MCP verdicts for the same inputs and policy.

## Prerequisites

- A Postgres connection string in `DATABASE_URL` (Supabase works). Prefer a read‑only role and a replica.
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

Configure MCP to use `@nockhq/mcp@latest` and provide a database URL via env:

```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nockhq/mcp@latest"],
      "env": {
        "DATABASE_URL": "postgres://user:pass@host:5432/db" // or SUPABASE_DB_URL
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

