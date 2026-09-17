# Nock

Pattern linters for DDL. Nock gates risky migrations in CI and MCP using your table sizes, Postgres lock classes, and `lock_timeout` policy — and it never applies migrations.

CLI ≡ Action ≡ MCP — the same verdict JSON for the same inputs.

## Quick start: check a migration with an estate file

```bash
corepack enable
pnpm install
pnpm build
node packages/cli/dist/bin/nock.js check \
  --sql fixtures/railway_oct.sql \
  --estate fixtures/estate_billion.json \
  --format json
```

Exit codes: 0 pass, 1 warn-only (yellow when fail_on=yellow), 2 fail.

Two ways to provide an estate:
- Bring your own estate — paste/commit `.nock/estate.json`: see `docs/guides/quick-start-estate-file.md`
- Sync estate yourself — run `nock sync-estate` on your runner: see `docs/guides/sync-estate.md`

## Keep estate fresh with sync-estate

Generate `.nock/estate.json` with a read‑only role (prefer a replica) on your own GitHub runner and use it in PR checks. Guide: `docs/guides/sync-estate.md`

## Add Nock to GitHub Actions

See `packages/action/action.yml` and copy into `.github/workflows/nock.yml`:

```yaml
name: Nock
on:
  pull_request:
    paths: ['migrations/**', '.nock/**']
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Nock check
        uses: ./.github/actions/nock  # example-only; replace with your published action or use CLI
        with:
          migration-path: migrations/
          # Optional: download hosted estate to file (Team)
          # estate-api-url: https://example.workers.dev/v1/estate/my-repo
          # estate-api-token: ${{ secrets.NOCK_ESTATE_API_TOKEN }}
          # File fallback (OSS/local)
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Grants for sync-estate

Create a least‑privilege read‑only role that can run the catalogue query (no row data) and prefer connecting to a replica. Guide: `docs/guides/grants-sync-estate.md`

## MCP: check before apply

See `@nock/mcp` — provides `check_before_apply`, `explain_lock`, `list_rules`. Golden tests ensure CLI JSON equals MCP JSON on identical inputs.

## Rules

| Rule | Status | Notes |
|------|--------|-------|
| R001 — CREATE INDEX w/o CONCURRENTLY | Implemented | Lock mode SHARE; red ≥10k rows |
| R002 — CIC inside transaction | Stub | Will add matcher |
| R003 — ADD COLUMN … DEFAULT <volatile> (rewrite) | Stub | Will add matcher |
| R004 — ADD COLUMN nullable/constant-default on hot table w/o lock_timeout | Implemented (partial) | Size-gated; requires `lock_timeout`; constant-default nuance later |
| R005 — SET NOT NULL w/o validated CHECK | Implemented (partial) | Assumes unsafe on large tables (no catalog check yet) |
| R006 — ADD CHECK w/o NOT VALID | Implemented | Red ≥50k rows |
| R007 — ADD FK w/o NOT VALID | Stub | Will add matcher |
| R008 — ALTER TYPE non-binary-coercible | Stub | Will add matcher |
| R009 — DROP/RENAME | Stub | Will add matcher (yellow) |
| R010 — DDL w/o lock_timeout on hot tables | Implemented (partial) | Applied to common DDL shapes |
| R011 — Live locks advisory | Out of scope |
| R012 — VACUUM FULL / CLUSTER / non-concurrent REINDEX | Implemented | Always red in CI |

## Docs index

- Quick start: check a migration with an estate file — `docs/guides/quick-start-estate-file.md`
- Keep estate fresh with sync-estate — `docs/guides/sync-estate.md`
- Grants for sync-estate — `docs/guides/grants-sync-estate.md`
- Security notes — `docs/SECURITY.md`
- Development — `docs/DEVELOPMENT.md`
- License — MIT (see `LICENSE`)

## Stub only: Nock Team (hosted estate + org policy + audit)

Not launch focus. Hosted estate distribution with envelope encryption, organization policy storage, and audit trails. Public docs will expand here when available.

## License

MIT
