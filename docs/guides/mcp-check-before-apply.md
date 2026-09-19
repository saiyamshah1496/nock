# MCP: check before apply

Use Nock in an agent loop to check a migration before applying it. For Nock Team partners, MCP prefers your hosted estate (token) and returns the same verdict JSON as the CLI. Free/local still works with a file path.

## Install and configure (Cursor/Claude MCP)

Option A — via npx (recommended)

```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nockhq/mcp@0.1.5"]
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
- Team token (optional): set `NOCK_TEAM_API_TOKEN` in your environment so MCP can fetch your hosted estate/policy. Aliases also accepted: `NOCK_ESTATE_API_TOKEN`, `NOCK_STATS_API_TOKEN`.
  - Example (Cursor settings or host supports env on MCP servers):
    ```json
    {
      "mcpServers": {
        "nock": {
          "command": "npx",
          "args": ["-y", "@nockhq/mcp@0.1.5"],
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

Team partners should pass the hosted estate URL; you do not need to download the estate to a file first.

Call `nock.check_before_apply` with your migration SQL and hosted fields:

```json
{
  "sql": "ALTER TABLE public.sessions ADD COLUMN last_seen_at timestamp with time zone;",
  "estateApiUrl": "https://nock.saiyamshah1496.workers.dev/v1/estate/owner/repo"
}
```

Behavior
- When `estateApiUrl` + a valid token are present, MCP fetches the hosted estate and organization policy (policy via the API base derived from `estateApiUrl`; you can also pass `apiBaseUrl` explicitly).
- If hosted fetch is unavailable, MCP falls back to `estatePath` when provided; otherwise it returns a clear error (no silent empty estate).

Optional
- `policyPath` (JSON only). If omitted, a safe default policy is used. YAML policy paths are not supported in MCP at this time; use the default or convert to JSON.
- `pgVersion` can override autodetection for specific checks.

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
npx @nockhq/cli@0.1.5 check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \ 
  --format json
```

Hosted parity is also covered: same SQL + same hosted estate → MCP verdict JSON ≡ CLI JSON.

## Non-goals

- No apply: MCP does not run or apply migrations.
- No database connection: MCP tools read hosted snapshots (Team) or local files you pass; they do not connect to Postgres.
- No hosted MCP: the server runs locally via stdio; there’s no managed MCP endpoint.

