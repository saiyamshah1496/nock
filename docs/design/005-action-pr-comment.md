# 005 — Action PR comment

Goal: Memorable PR comment that educates and unblocks safe rewrites.

Options
- Markdown comment projection of VerdictV1 with an upsert marker.
- SARIF annotations only: less expressive for pedagogy.

Decision
- Post a single upserted comment with marker `<!-- nock:verdict -->`.
- Must include: lock mode, `n_live_tup`, estimated hold range (approx), rules hit, remediation SQL with `lock_timeout`.
- File-mode stats only in Phase 1; hosted fetch later.

Acceptance criteria
- On RED/YELLOW, comment includes SHARE for non-concurrent index, row count formatted, and a `SET lock_timeout` before fix SQL.
- Action respects `fail-on` and sets conclusion accordingly.

