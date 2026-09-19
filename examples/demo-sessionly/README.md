# Sessionly → Nock MCP (DEMO‑ONLY) — Loom demo package

This folder is for a Loom demo only. Not for production. Do not merge unless explicitly approved by Saiyam.

What this is
- A realistic Sessionly Requests UI (product‑looking) used only as a prop.
- Staff‑provided staging estate and SQL fixtures to drive a check‑before‑apply narrative.
- An MCP configuration for Cursor so the agent can run Nock checks locally.

What this is not
- Not a live app; the UI never shows fail/pass — all verdicts happen in Cursor/MCP (and deploy checks).
- Not a deployment flow; Nock never applies migrations.

Open the UI (for Loom)
```bash
open examples/demo-sessionly/ui/index.html
# or serve the folder if preferred
python3 -m http.server 8765 --directory examples/demo-sessionly/ui
```

Locked demo flow
1) Start on Requests board in the Sessionly UI (feature requests SESS‑184 / 191 / 203). No verdicts on this page.
2) Cursor agent drafts a naive, ORM‑like DDL from the request.
3) Run Nock MCP check_before_apply against staging using the estate file → PASS/soft.
4) Run the same SQL against prod by live‑refreshing the estate from DATABASE_URL → FAIL (R001/R010 and/or R003/R005).
5) Agent narrates Nock’s verdict in plain English, remediates, and re‑checks prod → PASS.

Quick start — CLI checks (0.1.7)
- Staging (file estate):
```bash
npx @nockhq/cli@0.1.7 check \
  --sql examples/demo-sessionly/sql/naive-bad.sql \
  --estate examples/demo-sessionly/estate-staging.json
```
- Production (live refresh; read‑only catalogue, no writes):
```bash
export DATABASE_URL=postgres://USER:PASS@HOST:5432/DB
npx @nockhq/cli@0.1.7 check \
  --sql examples/demo-sessionly/sql/naive-bad.sql \
  --database-url \"$DATABASE_URL\"
```
- Remediated example:
```bash
npx @nockhq/cli@0.1.7 check \
  --sql examples/demo-sessionly/sql/good.sql \
  --database-url \"$DATABASE_URL\"
```

Cursor MCP settings (ready to paste)
Use the Nock MCP via npx. Provide DATABASE_URL in your environment for prod checks.
```json
{
  "mcpServers": {
    "nock": {
      "command": "npx",
      "args": ["-y", "@nockhq/mcp@0.1.7"]
    }
  }
}
```
See also: `examples/demo-sessionly/mcp.cursor.json`.

Files in this folder
- estate-staging.json — sessions.n_live_tup ≈ 200 (staging quiet/green)
- sql/naive-bad.sql — first‑draft DDL that will fail on prod (hot table)
- sql/good.sql — remediated DDL (CONCURRENTLY + lock_timeout, nullable add, NOT VALID CHECK)
- sql/A-*.sql, B-*.sql, C-*.sql — per‑case pairs (bad vs good)
- sql/prod-add-user-id.sql — optional prod prep used for C‑case when needed
- notes/LOOM-RULES.md — exact rule IDs to narrate (R001/R010, R003, R005)
- notes/SEED-NOTES.md — local Postgres tips (follow the live‑estate pattern in repo)
- agent-rules.md — agent instructions (implement feature requests; check staging then prod)
- loom-outline.md — step‑by‑step Loom script (Requests board first)
- ui/ — product‑looking Requests UI (no demo chrome; no verdict rows)

Constraints
- DEMO‑ONLY banners live here in README, not in the UI.
- Do not expand Team console/OAuth; keep free, check‑only.
- Prefer `@nockhq/*@0.1.7` for npx in commands.

Acknowledgements
- Fixtures provided by Staff for this specific demo; do not invent new SQL/estate beyond this folder.
