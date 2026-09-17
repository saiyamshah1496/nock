# MCP: check before apply

Use Nock in an agent loop to check a migration before applying it. This runs locally against an estate snapshot you provide and returns the same verdict JSON as the CLI.

What this is
- A local MCP server that exposes tools: `check_before_apply`, `explain_lock`, `list_rules`
- No database connection; you pass a file path to your estate snapshot
- Same verdicts as the CLI for identical inputs (CLI ≡ Action ≡ MCP)

## Install and configure (Cursor/Claude MCP)

Option A — via npx (recommended for strangers)

```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nock/mcp"]
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
- Transport: stdio (no network port). The `@nock/mcp` package provides a `nock-mcp` bin that speaks MCP over stdio.
- Estate lives on your machine/repo; point `estatePath` to `.nock/estate.json` (or your chosen path).

## First tool call — check_before_apply

Call `nock.check_before_apply` with your migration SQL and paths:

```json
{
  "sql": "ALTER TABLE public.sessions ADD COLUMN last_seen_at timestamp with time zone;",
  "estatePath": ".nock/estate.json"
}
```

Optional
- `policyPath` may be provided (JSON only). If omitted, a safe default policy is used. YAML policy paths are not supported in MCP at this time; use the default or convert to JSON.
- `pgVersion` can override autodetection for specific checks.

## Verdict JSON parity

The JSON returned by `check_before_apply` is the same schema and content as:

```bash
node packages/cli/dist/bin/nock.js check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --format json
```

This parity is covered by golden tests in this repo.

## Non-goals

- No apply: MCP does not run or apply migrations.
- No database connection: MCP tools read local files you pass; they do not connect to Postgres.
- No hosted MCP: the server runs locally via stdio; there’s no managed MCP endpoint.

