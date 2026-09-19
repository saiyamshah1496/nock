# MCP: check before apply

Use Nock in an agent loop to check a migration before applying it. MCP returns the same verdict JSON as the CLI. Provide either a local estate file or a `databaseUrl` (or set `DATABASE_URL` / `SUPABASE_DB_URL`) to refresh the estate live from Postgres before checking (Path C thin). Free and check‑only; no file write.

Positioning
- MCP is an advisory “check-before-apply” surface for agents.
- The hard merge gate lives in your GitHub Action or the Nock App.
- CLI ≡ Action ≡ MCP ≡ App — same verdict JSON for the same inputs.

## Install and configure (Cursor/Claude MCP)

This repo ships committed IDE configs so a local Cursor/VS Code window gets the same file-based Nock session as the CLI:

- Cursor: [`.cursor/mcp.json`](../../.cursor/mcp.json)
- VS Code: [`.vscode/mcp.json`](../../.vscode/mcp.json)

Both start `packages/mcp/dist/bin.js` with `NOCK_WORKSPACE=${workspaceFolder}`. Build first (`pnpm --filter @nockhq/mcp build` or `pnpm build`).

Option A — via npx (recommended for other projects)

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

Option B — from source (this repo; same as the committed IDE files)

```json
{
  "mcpServers": {
    "nock": {
      "command": "node",
      "args": ["${workspaceFolder}/packages/mcp/dist/bin.js"],
      "env": { "NOCK_WORKSPACE": "${workspaceFolder}" }
    }
  }
}
```

Notes
- Transport: stdio (no network port). The `@nockhq/mcp` package provides a `nock-mcp` bin that speaks MCP over stdio.
- Hosted estate + push is separate and not part of this PR.

## Session and files (IDE)

Like the local CLI (`--sql` / `--estate` file paths), MCP can see the workspace session and files:

| Tool / resource | Purpose |
|-----------------|---------|
| `get_session` / `nock://session` | Workspace root, preferred `.nock/estate.json`, policy JSON, and discovered SQL/estate/policy files. Never returns secret values — only whether `DATABASE_URL` or a Team token is set. |
| `list_files` / `nock://files` | Same file list (`.nock/`, `migrations/`, `fixtures/`, `examples/`, root `estate.json` / `policy*.json`). |
| `read_file` | Read one of those files. Paths must stay inside the workspace; `node_modules` / `dist` / `.git` are rejected. |
| `check_before_apply` | Accepts `sql` **or** `sqlPath` (a workspace `.sql` file). When `estatePath` is omitted, uses `.nock/estate.json` from the session if present. |

Example — check a file the way the CLI does:

```json
{
  "sqlPath": "migrations/001.sql",
  "estatePath": ".nock/estate.json"
}
```

Or rely on the session’s conventional estate file:

```json
{
  "sqlPath": "examples/live-estate-database-url/bad.sql"
}
```
 
 

## Tool call — local file or live refresh

Optional
- `policyPath` (JSON only). If omitted, a safe default policy is used. YAML policy paths are not supported in MCP at this time; use the default or convert to JSON.
- `pgVersion` can override autodetection for specific checks.
- Path C thin (free, check‑only): pass `databaseUrl` (or set `DATABASE_URL` / `SUPABASE_DB_URL`) to refresh estate live from Postgres before evaluating. Example:
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

