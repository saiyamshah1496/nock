# Nock Team — partner setup (design partner thin‑slice)

This guide helps a design partner connect Nock Team so PR checks run using your hosted estate and organization policy — without committing estate files.

Keep the other paths intact and separate:
- Bring your own estate — `docs/guides/quick-start-estate-file.md`
- Sync estate yourself — `docs/guides/sync-estate.md`
- Nock Team (hosted) — this guide

## What you’ll receive

- A Team API token (bearer) for your organization
  - Preferred env name: `NOCK_TEAM_API_TOKEN`
  - Accepted aliases: `NOCK_ESTATE_API_TOKEN` (ok), `NOCK_STATS_API_TOKEN` (legacy only)
- A KEK (key‑encryption key), base64 32 bytes, used to envelope‑encrypt your estate snapshots before push
  - Env name: `NOCK_ESTATE_KEK` (alias `NOCK_STATS_KEK`)
  - For the thin‑slice, the KEK is Nock‑held and disclosed to partners (see Security notes)

## 1) Store your token and KEK as secrets

In your GitHub repo:
- Settings → Secrets and variables → Actions → New repository secret
  - Name: `NOCK_TEAM_API_TOKEN` → paste the token you received
  - Name: `NOCK_ESTATE_KEK` → paste the base64 32‑byte KEK you received

Local/dev shells can export these for testing:

```bash
export NOCK_TEAM_API_TOKEN="...token..."
export NOCK_ESTATE_KEK="...base64-32-bytes..."
```

## 2) Run PR checks with hosted estate (no committed files)

Use either the packaged Action or the CLI workflow. Both prefer hosted by token and fall back to a file when not configured.

- Default API base for examples: `https://nock.saiyamshah1496.workers.dev`
- Repo identifier pattern: `/v1/estate/:owner/:repo`

Action example (replace `owner/repo`):

```yaml
# See also: examples/workflows/nock-action.yml
name: Nock — Action (hosted estate)
on: { pull_request: { paths: ['migrations/**', '.nock/**'] } }
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - name: Nock check (Action)
        uses: ./.github/actions/nock  # or your published action ref
        with:
          migration-path: migrations/
          estate-api-url: https://nock.saiyamshah1496.workers.dev/v1/estate/owner/repo
          estate-api-token: ${{ secrets.NOCK_TEAM_API_TOKEN }}
          # File fallback when hosted unavailable (optional)
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

CLI example (same behavior as Action):

```bash
# Prefer hosted by token; falls back to --estate/--policy when not provided
npx @nockhq/cli check \
  --sql migrations/001.sql \
  --estate-api-url "https://nock.saiyamshah1496.workers.dev/v1/estate/owner/repo" \
  --estate-api-token "$NOCK_TEAM_API_TOKEN" \
  --format json
```

MCP mirrors the CLI flags: `estateApiUrl`, `estateApiToken`, `apiBaseUrl` with the same env fallbacks.

Freshness behavior (locked):
- Warn when the hosted snapshot’s `captured_at` is older than 7 days.
- If older than 30 days, size‑dependent gates are neutralized; non‑size rules can still fail.

## 3) (Optional) Sync and push your estate on a schedule

Schedule `sync-estate` to read from a replica and push an envelope‑encrypted snapshot to the hosted API. The Action and App will GET the “last good” snapshot during PRs.

```yaml
# See also: examples/workflows/nock-sync-push.yml
name: Nock — Sync estate and push
on:
  schedule: [{ cron: '0 */6 * * *' }]
  workflow_dispatch: {}
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: corepack enable
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r build
      - name: Run sync-estate and push
        env:
          PG_ESTATE_URL: ${{ secrets.PG_ESTATE_URL }}          # read-only replica
          NOCK_TEAM_API_TOKEN: ${{ secrets.NOCK_TEAM_API_TOKEN }}
          NOCK_ESTATE_KEK: ${{ secrets.NOCK_ESTATE_KEK }}      # base64 32 bytes
        run: |
          set -euo pipefail
          mkdir -p .nock
          node packages/cli/dist/bin/nock.js sync-estate \
            --database-url "$PG_ESTATE_URL" \
            --out .nock/estate.json \
            --push-url "https://nock.saiyamshah1496.workers.dev/v1/estate/owner/repo" \
            --token "$NOCK_TEAM_API_TOKEN"
```

Notes:
- The CLI requires `NOCK_ESTATE_KEK` to push (unless `NOCK_DEV_PLAINTEXT_ESTATE=1` for local dev).
- Never commit the KEK or estate to your repo when using the hosted path.

## 4) Export your data (self‑service)

Use your token with the export routes (PR2). Formats are per 022.

```bash
# Estate snapshot (EnvelopeV1 or plaintext JSON)
curl -fsSL -H "Authorization: Bearer $NOCK_TEAM_API_TOKEN" \
  "https://nock.saiyamshah1496.workers.dev/v1/export/estate/owner/repo?format=envelope" \
  -o estate.envelope.json

curl -fsSL -H "Authorization: Bearer $NOCK_TEAM_API_TOKEN" \
  "https://nock.saiyamshah1496.workers.dev/v1/export/estate/owner/repo?format=plaintext" \
  -o estate.json

# Audit log (JSONL is the locked default)
curl -fsSL -H "Authorization: Bearer $NOCK_TEAM_API_TOKEN" \
  "https://nock.saiyamshah1496.workers.dev/v1/export/audit/owner/repo?since=2026-09-01T00:00:00Z&format=jsonl" \
  -o audit.jsonl
```

## Security notes (honest)

- Nock never applies migrations.
- Partner tokens are hashed at rest (sha256 of the base64 token). Revocation is supported.
- Estate snapshots contain no row data. The push route rejects snapshots whose `captured_at` differs from server time by more than 1 hour.
- KEK handling for the thin‑slice: Nock‑held KEK is disclosed to partners for envelope encryption of snapshots. See `docs/design/022-team-data-plane.md` for EnvelopeV1 details. Production posture may differ.

## References

- Examples: `examples/workflows/nock-action.yml`, `examples/workflows/nock.yml`, `examples/workflows/nock-sync-push.yml`
- Design: `docs/design/022-team-data-plane.md`, `docs/design/023-nock-team-control-plane.md`
- Free paths:
  - Bring your own estate — `docs/guides/quick-start-estate-file.md`
  - Sync estate yourself — `docs/guides/sync-estate.md`

