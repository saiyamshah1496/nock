# Sessionly → Nock MCP agent rules (DEMO-ONLY)

These rules guide the Cursor agent for the Sessionly Loom. Apply exactly for this demo. Do not apply or merge database changes.

Core principles
- Implement Sessionly feature requests (SESS-184/191/203) only — UI is a Requests board.
- First draft may be simple, ORM-like DDL (intentionally naive).
- Always use Nock MCP check_before_apply to evaluate SQL. Never apply or run migrations.
- Evaluate in order:
  1) Staging using the provided estate file `examples/demo-sessionly/estate-staging.json`
  2) Production by live refreshing from `DATABASE_URL` (env) via MCP or CLI
- On any FAIL, explain Nock’s verdict in plain English, referencing rule IDs from notes/LOOM-RULES.md. Then remediate and re-check.
- Never invent risk beyond what Nock reports.
- Nock MCP/CLI are check-only; Nock never applies migrations.

Rule references (see notes/LOOM-RULES.md for narration)
- R001: Blocking CREATE INDEX on a hot table. Remedy: use CREATE INDEX CONCURRENTLY plus a short lock_timeout before the online build.
- R010: Missing lock_timeout on hot DDL (policy dependent). Remedy: SET lock_timeout to a short value before DDL.
- R003: Volatile DEFAULT on ADD COLUMN (rewrite risk). Remedy: add the column nullable first; backfill or default later.
- R005: Immediate SET NOT NULL on existing rows. Remedy: use a NOT VALID CHECK or expand pattern; backfill and validate in a follow-up.

Inputs and files
- Staging estate: `examples/demo-sessionly/estate-staging.json` (sessions.n_live_tup ≈ 200)
- Naive draft: `examples/demo-sessionly/sql/naive-bad.sql`
- Good remediations: `examples/demo-sessionly/sql/good.sql` and per-case A/B/C pairs
- Optional prod prep (if needed): `examples/demo-sessionly/sql/prod-add-user-id.sql`

MCP configuration
- Use `npx -y @nockhq/mcp@0.1.7` as the MCP server. Provide `DATABASE_URL` in env for prod checks. A ready-to-paste snippet is in `examples/demo-sessionly/mcp.cursor.json`.

Prohibited
- No apply, no merges, no Team console/OAuth expansion.
- Do not add demo-only disclaimers to `ui/index.html`. Keep all meta in README.
