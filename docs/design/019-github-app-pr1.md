# 019 — GitHub App PR1 landed

Scope: App skeleton + install + webhook plumbing that publishes an always‑Neutral Checks API `check_run` titled “Nock: DDL gate”. No DDL engine yet.

What’s included
- Hono route: `POST /github/webhook` in `@nockhq/api` Worker.
- Webhook security: HMAC SHA‑256 verification against `GITHUB_WEBHOOK_SECRET`.
- GitHub App auth: App JWT (RS256) from `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` → installation token.
- Events: `pull_request` opened/synchronize/reopened/ready_for_review.
- Checks API: creates a Neutral `check_run` on PR head SHA with a short scaffold summary.
- Noise guard: only runs when PR touches default trigger globs:
  - `**/migrations/**/*.sql`
  - `**/db/migrations/**/*.sql`
  - `**/supabase/migrations/**/*.sql`
  - `**/.nock/**`
- Unit tests: signature verification, glob matching, and check_run payload shape (vitest).

Docs + setup
- See `docs/design/018-github-app.md` (locked naming and behavior).
- `docs/DEVELOPMENT.md` adds a GitHub App section with the required secrets and permission matrix.
- Manual step (Saiyam): create the GitHub App (“Nock DDL Gate”), set permissions, and wire installation to your test org/repo. Then set secrets on the deployed Worker:
  - `GITHUB_WEBHOOK_SECRET`
  - `GITHUB_APP_ID` (numeric)
  - `GITHUB_APP_PRIVATE_KEY` (PEM)

Deferred to PR2/PR3
- PR2: Resolve estate + fetch changed SQL; invoke `@nockhq/core`; publish approve/block verdict in Checks.
- PR3: Optional PR comment on fail; repo config (`nock.yml`) polish; estate fallbacks docs.

