# Loom outline — Sessionly → Nock MCP (DEMO-ONLY)

Goal
- Show a realistic Sessionly UI ticket → agent drafts naive DDL → Nock MCP check on staging (pass/soft) → same SQL against prod (fail) → remediate → prod pass.

Prep (off camera, or quick preface)
- Ensure branch is checked out; open `examples/demo-sessionly/ui/index.html` in a browser (fullscreen).
- In Cursor settings, add the Nock MCP server (JSON snippet in `examples/demo-sessionly/mcp.cursor.json`). Set `DATABASE_URL` for prod checks.

Scene 1 — Requests board (product UI; no verdicts on page)
1) Show Staging (~200) vs Production (500,000) indicators in the header.
2) Click feature request SESS-184 “Faster archive search” and briefly read problem/impact/acceptance.
3) Call out: “This page doesn’t show pass/fail — the agent drafts DDL and checks in Cursor/MCP.”

Scene 2 — Staging check (file estate)
4) In Cursor, run Nock via MCP check_before_apply on staging using the estate file:
   - Inputs: `sql: sql/naive-bad.sql`, `estatePath: examples/demo-sessionly/estate-staging.json`
   - Expectation: PASS or soft/yellow (below hot-size thresholds).
   - CLI alt:
     ```bash
     npx @nockhq/cli@0.1.7 check \
       --sql examples/demo-sessionly/sql/naive-bad.sql \
       --estate examples/demo-sessionly/estate-staging.json
     ```

Scene 3 — Production check (live refresh)
5) Switch to prod and re-run with live estate refresh (no writes):
   - Provide `DATABASE_URL` (env) to MCP or CLI.
   - Expectation: FAIL with R001 (blocking index) and often R010 (missing lock_timeout).
   - CLI alt:
     ```bash
     export DATABASE_URL=postgres://USER:PASS@HOST:5432/DB
     npx @nockhq/cli@0.1.7 check \
       --sql examples/demo-sessionly/sql/naive-bad.sql \
       --database-url "$DATABASE_URL"
     ```
   - Narrate in plain English. Reference rule IDs from `notes/LOOM-RULES.md`.

Scene 4 — Remediate and re-check
6) Swap in a safe remediation:
   - Use `examples/demo-sessionly/sql/good.sql`
     - `CREATE INDEX CONCURRENTLY ...` + `SET lock_timeout = '2s'`
     - Additive column without volatile DEFAULT
     - NOT VALID CHECK instead of immediate SET NOT NULL
   - Re-run against prod:
     ```bash
     npx @nockhq/cli@0.1.7 check \
       --sql examples/demo-sessionly/sql/good.sql \
       --database-url "$DATABASE_URL"
     ```
   - Expectation: PASS (or acceptable green).

Optional Scene 5 — B/C quick mentions
7) B-case (volatile DEFAULT) and C-case (NOT NULL) are included as pairs under `sql/B-*` and `sql/C-*`.
   - For C-case on prod, ensure `user_id` exists first (see `sql/prod-add-user-id.sql`).

Close
- Reiterate: MCP is check-before-apply; Nock never applies migrations. All demo-only disclaimers live in `examples/demo-sessionly/README.md`, not in the UI.
