# MCP: check before apply

Use Nock in an agent loop to check a migration before applying it. For Nock Team partners, MCP prefers your hosted estate (token) and returns the same verdict JSON as the CLI. Free/local still works with a file path. For demos, you can also provide a `databaseUrl` (or set `DATABASE_URL` / `SUPABASE_DB_URL`) to refresh the estate live from Postgres before checking — this is experimental Path C thin.

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
- Team token (optional): you can pass it inline as `estateApiToken` in tool calls, or set `NOCK_TEAM_API_TOKEN` in your environment so MCP can fetch your hosted estate/policy. Aliases also accepted: `NOCK_ESTATE_API_TOKEN`, `NOCK_STATS_API_TOKEN`.
  - Example (Cursor settings or host supports env on MCP servers):
    ```json
    {
      "mcpServers": {
        "nock": {
          "command": "npx",
          "args": ["-y", "@nockhq/mcp@latest"],
          "env": { "NOCK_TEAM_API_TOKEN": "…your-org-token…" }
        }
      }
    }
    ```
  - Or export in your shell:
    ```bash
    export NOCK_TEAM_API_TOKEN="…"
    ```

## First tool call — hosted (Team)

Team partners should pass the hosted estate URL and a token; you do not need to download the estate to a file first.

Call `nock.check_before_apply` with your migration SQL and hosted fields:

```json
{
  "sql": "ALTER TABLE public.sessions ADD COLUMN last_seen_at timestamp with time zone;",
  "estateApiUrl": "https://nock.saiyamshah1496.workers.dev/v1/estate/owner/repo",
  "estateApiToken": "…your-org-token…"
}
```

Behavior
- When `estateApiUrl` + a valid token are present (passed as `estateApiToken` or via env), MCP fetches the hosted estate and organization policy (policy via the API base derived from `estateApiUrl`; you can also pass `apiBaseUrl` explicitly).
- If hosted fetch is unavailable, MCP falls back to `estatePath` when provided; otherwise it returns a clear error (no silent empty estate).

Optional
- `policyPath` (JSON only). If omitted, a safe default policy is used. YAML policy paths are not supported in MCP at this time; use the default or convert to JSON.
- `pgVersion` can override autodetection for specific checks.
- Experimental Path C thin: pass `databaseUrl` (or set `DATABASE_URL` / `SUPABASE_DB_URL`) to refresh estate live from Postgres before evaluating. Example:
  ```json
  {
    "sql": "CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);",
    "databaseUrl": "postgres://user:pass@host:5432/db"
  }
  ```

## Local-only (free) — fallback

If you are not using Team hosted, pass a file path:

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

Hosted parity is also covered: same SQL + same hosted estate → MCP verdict JSON ≡ CLI JSON.

## Non-goals

- No apply: MCP does not run or apply migrations.
- No database connection (production): MCP tools read hosted snapshots (Team) or local files you pass. The `databaseUrl` path is an experimental Path C convenience to refresh an estate before checking; it reads only catalogue metadata (no row data). Prefer a read‑only role and a replica.
- No hosted MCP: the server runs locally via stdio; there’s no managed MCP endpoint.

