# 020 — GitHub App PR2: core DDL verdict in Checks

Scope: Upgrade the GitHub App from PR1’s neutral scaffold to a real approve/block verdict backed by `@nockhq/core`.

What changed vs PR1
- Always publish a Checks API `check_run` titled “Nock: DDL gate” when locked trigger globs match:
  - `**/migrations/**/*.sql`
  - `**/db/migrations/**/*.sql`
  - `**/supabase/migrations/**/*.sql`
  - `**/.nock/**`
- Estate resolution (App v1 — no hosted/team download):
  1) `.nock/estate.json` at repo root on PR head (fallback to base)
  2) Optional redirect via `estate-path:` in `nock.yml` or `.github/nock.yml`
  3) If no estate found, publish a Neutral check with links to:
     - `docs/guides/quick-start-estate-file.md`
     - `docs/guides/sync-estate.md`
- Policy: use repo-committed `.nock/policy.yml` (if present) or `policy.default.yml`; otherwise fall back to a minimal default (fail_on: red).
- Fetch changed SQL file contents via the GitHub Contents API (PR head) and run `@nockhq/core` `check(...)`.
- Verdict → Checks conclusion:
  - red → `failure` (blocks)
  - yellow → `neutral` (warns)
  - green → `success` (passes)
- Check output includes a concise summary plus top violations and remediation hints.

Out of scope (deferred to PR3+)
- PR comments renderer/upsert
- Hosted estate download / Team integration
- Marketplace polish

Testing
- Added unit tests for:
  - estate resolution order (head/base, `estate-path:` in config)
  - verdict→Checks mapping (red/failure, yellow/neutral, green/success)
  - integration on fixtures: red (e.g., `VACUUM FULL`) and yellow (e.g., `ATTACH PARTITION`)

Secrets and permissions remain unchanged from PR1. See `docs/DEVELOPMENT.md` for setup.
