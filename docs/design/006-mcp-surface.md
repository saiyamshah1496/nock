# 006 — MCP surface

Goal: Agent tool that returns the same verdict JSON as the CLI for identical inputs.

Options
- Local-first MCP using `@modelcontextprotocol/sdk`, reading file paths.
- Hosted-backed MCP hitting API: out of scope Phase 1.

Decision
- Implement `check_before_apply({ sql, pgVersion?, statsPath?, policyPath? })`, `explain_lock({ sql })`, `list_rules()`.
- No arbitrary SQL execution; no apply/migrate tool; scope to file paths only.

Acceptance criteria
- Golden test: CLI `--format json` output equals MCP `check_before_apply` output on the same fixture.
- Cursor one-liner usage in README.

