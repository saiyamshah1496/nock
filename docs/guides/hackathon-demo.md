# Hackathon demo: live estate from DATABASE_URL (Path C thin)

This is a minimal, same-day demo path to show Nock’s red → green loop using a live Postgres (Supabase‑friendly) connection string. It refreshes the estate catalogue (columns, constraints, indexes, sizes) directly from the database just before a check. No row data is read or stored.

Constraints (hackathon‑thin):
- Nock is an estate‑aware migration safety gate — not a pattern linter or a proxy.
- Live refresh is a convenience for demos only. The recommended free path remains BYO/self‑sync to `.nock/estate.json` on your own runner.
- CLI ≡ MCP verdicts for the same inputs.

## Prerequisites

- A Postgres `DATABASE_URL` (Supabase works). Prefer a read‑only role and a replica.
- Node 20+, `npx`.

## 1) Seed a hot-ish `sessions` table (optional)

If you don’t already have a sizable `public.sessions` table, run:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f examples/hackathon-supabase/seed.sql
```

This creates `public.sessions` and inserts ~1.2M rows.

## 2) Show red on the “bad” migration

Single-shot check that refreshes estate live from the DB:

```bash
npx @nockhq/cli@latest check \
  --sql examples/hackathon-supabase/bad.sql \
  --database-url "$DATABASE_URL" \
  --format json --fail-on red
```

Expected:
- Verdict `fail`
- Violations include `R001` (non‑concurrent CREATE INDEX) and `R010` (missing `lock_timeout` on hot table)

## 3) Show green on the “good” migration

```bash
npx @nockhq/cli@latest check \
  --sql examples/hackathon-supabase/good.sql \
  --database-url "$DATABASE_URL" \
  --format json --fail-on red
```

Expected:
- Verdict `pass`

## MCP setup (Cursor/Claude MCP)

Configure MCP to use `@nockhq/mcp@latest`:

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

Agent tool call (bad → red):

```json
{
  "toolName": "nock.check_before_apply",
  "args": {
    "sql": "CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);"
  }
}
```

Then switch to “good” SQL:

```json
{
  "toolName": "nock.check_before_apply",
  "args": {
    "sql": "SET lock_timeout = '3s'; CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_archived_at ON public.sessions(archived_at);"
  }
}
```

## 3‑minute script (talk track)

1. “Nock gates risky Postgres DDL based on your estate — sizes + catalogue. I’ll connect to a DB and check a migration without pre‑downloading a file.”
2. “First I’ll show the unsafe path: non‑concurrent index on a hot `sessions` table with no `lock_timeout`.”
3. Run the bad check (CLI or MCP) — see `R001` and `R010` red.
4. “Now the safe path: set `lock_timeout` and use `CONCURRENTLY`.”
5. Run the good check — see `pass`.
6. “For CI you’d keep estate fresh via `nock sync‑estate` on your runner (or Nock Team hosted). This live DB path is an experimental convenience for today’s demo.”

