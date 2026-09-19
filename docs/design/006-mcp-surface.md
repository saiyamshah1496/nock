# 006 — MCP surface

Goal: Agent tool that returns the same verdict JSON as the CLI for identical inputs.

Options
- Local-first MCP using `@modelcontextprotocol/sdk`, reading file paths.
- Hosted-backed MCP hitting API: out of scope Phase 1.

Decision
- Implement `check_before_apply({ sql, sqlPath?, pgVersion?, estatePath?, policyPath? })`, `explain_lock({ sql })`, `list_rules()`, plus IDE session/file tools (`get_session`, `list_files`, `read_file`) and `nock://session` / `nock://files` resources.
- No arbitrary SQL execution; no apply/migrate tool; scope to workspace file paths only (same local files as the CLI).
- Commit Cursor/VS Code mcp.json so an IDE session sees those files like a local `nock check --sql … --estate …`.

Acceptance criteria
- Golden test: CLI `--format json` output equals MCP `check_before_apply` output on the same fixture.
- Cursor one-liner usage in README.

