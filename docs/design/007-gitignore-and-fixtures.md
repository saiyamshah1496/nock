# 007 — Git hygiene and fixture matrix

Goal: Keep the PR diff reviewable (no vendored deps) and earn trust with a multi-fixture test matrix beyond a single outage.

Options
- Commit `node_modules`/`dist`: faster cold runs on some CIs; terrible diffs and conflicts.
- Ignore build artifacts and install per-run: standard for JS/TS repos; keeps PRs readable.

Decision
- Root `.gitignore` must ignore `node_modules/`, `**/node_modules/`, `dist/`, `**/dist/`, `coverage/`, `.turbo/`, `.DS_Store`, `*.tsbuildinfo`.
- Never commit vendored deps or build outputs in this repo. Keep `pnpm-lock.yaml`.

Why multi-fixture matrix matters
- Single-case fixtures (e.g., Railway Oct) overfit. We add distinct shapes to validate rules and parser assumptions:
  - R001 (non-concurrent index, SHARE)
  - R004/R010 (nullable ADD COLUMN on hot table without `lock_timeout`)
  - R006 (ADD CHECK without `NOT VALID`)
  - R005 (SET NOT NULL without validated CHECK)
  - R012 (VACUUM FULL)
  - Unknown DDL → YELLOW (never silent green)
- CI uses vitest golden tests to assert behavior and CLI≡MCP parity.

Acceptance criteria
- No `node_modules` or `dist` tracked in git.
- Fixtures and tests cover the above shapes and all pass locally.

