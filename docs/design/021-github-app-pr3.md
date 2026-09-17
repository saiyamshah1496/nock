# 021 — GitHub App PR3: Fail‑only PR comment

Status: implemented

Scope:
- Keep Checks API as source of truth (PR2). Always publish a check_run on relevant PRs.
- When the DDL verdict is red, post a single concise PR issues comment with:
  - Header: “Nock: DDL gate”
  - FAIL summary counts (red/yellow) and meta (policy id, engine, optional estate captured_at)
  - Top 5–8 findings: `[SEVERITY] rule_id: message` and fenced `sql` remediation when available
  - Stable HTML marker for de‑duplication: `<!-- nock-ddl-gate -->`
- Do not comment for PASS, WARN/neutral, or the Neutral no‑estate path.
- Never apply migrations; same `@nockhq/core` `VerdictV1` JSON as PR2.

Design:
- After successfully creating the verdict check_run, if `mapVerdictToConclusion(...)` returns `failure`, build a comment body and upsert it on the PR via the Issues Comments API.
- Upsert logic:
  - `GET /repos/{owner}/{repo}/issues/{number}/comments?per_page=100`
  - If a comment containing `<!-- nock-ddl-gate -->` exists, `PATCH /repos/{owner}/{repo}/issues/comments/{id}` with the new body.
  - Else, `POST /repos/{owner}/{repo}/issues/{number}/comments`.
  - If listing fails transiently, fall back to a single `POST`.
- Permissions: the App requires Pull requests: Write (in addition to Checks: Read & Write and Contents: Read).

Tests:
- Renderer unit test validates presence of header, marker, counts, and fenced SQL.
- Gating unit test verifies that comments are posted only for red verdicts and updated in place when marker is present.

Docs:
- Document `estate-path` in `nock.yml` or `.github/nock.yml` with a minimal example.
- Sequencing note: PR3 adds comments but does not change the Checks API contract from PR2.

