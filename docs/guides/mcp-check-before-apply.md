# MCP: check before apply (Cursor)

Use Nock in a Cursor/Claude MCP agent loop to check a migration before applying it. MCP returns the same verdict JSON as the CLI. Provide either a local estate file or a `databaseUrl` (or set `DATABASE_URL`) to refresh the estate live from Postgres before checking. Free and check‑only; no file write.

Positioning
- MCP is an advisory “check-before-apply” surface for agents.
- The hard merge gate lives in your GitHub Action or the Nock App.
- CLI ≡ Action ≡ MCP ≡ App — same verdict JSON for the same inputs.

## Install and configure (Cursor/Claude MCP)

Option A — via npx (recommended)

```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nockhq/mcp@latest"]
    }
  }
}
```

Option B — from source (this repo)

```json
{
  "mcpServers": {
    "nock": {
      "command": "node",
      "args": ["./packages/mcp/dist/bin.js"]
    }
  }
}
```

Notes
- Transport: stdio (no network port). The `@nockhq/mcp` package provides a `nock-mcp` bin that speaks MCP over stdio.
- Hosted estate + push is separate and not part of this PR.
 
 

## Tool call — local file or live refresh

Optional
- `policyPath` (JSON only). If omitted, a safe default policy is used. YAML policy paths are not supported in MCP at this time; use the default or convert to JSON.
- `pgVersion` can override autodetection for specific checks.
- Live DATABASE_URL check (free, check‑only): pass `databaseUrl` (or set `DATABASE_URL`) to refresh estate live from Postgres before evaluating. Example:
  ```json
  {
    "sql": "CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);",
    "databaseUrl": "postgres://user:pass@host:5432/db"
  }
  ```

## Local-only (free) — fallback

Use a file path:

```json
{
  "sql": "ALTER TABLE public.sessions ADD COLUMN last_seen_at timestamp with time zone;",
  "estatePath": ".nock/estate.json"
}
```

## Verdict JSON parity

The JSON returned by `check_before_apply` matches the CLI for the same inputs:

```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \ 
  --format json
```

Hosted parity is separate: Team hosted estate + push is not part of this PR.

## Non-goals

- No apply: MCP does not run or apply migrations.
- No database connection for writes: the `databaseUrl` path refreshes catalogue‑only metadata (no row data) before checking; it does not apply migrations.
- No hosted MCP: the server runs locally via stdio; there’s no managed MCP endpoint.

