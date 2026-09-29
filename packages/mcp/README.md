@nockhq/mcp — Nock MCP server
=============================

Cursor MCP server for Nock’s estate‑aware Postgres DDL check. Returns the same verdict JSON as the CLI and GitHub Action. Never applies migrations.

Install in Cursor
-----------------

Add to your Cursor `settings.json`:

```json
{
  "mcpServers": {
    "nock": { "command": "npx", "args": ["-y", "@nockhq/mcp@latest"] }
  }
}
```

Docs
----

- Guide: [docs/guides/mcp-check-before-apply.md](../../docs/guides/mcp-check-before-apply.md)
- Estate schema: [docs/reference/estate-schema.md](../../docs/reference/estate-schema.md)
