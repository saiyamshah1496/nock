# 014 — GitHub Action with hosted stats (Path B+) as default

Status: Accepted

## Summary

Make the customer GitHub Action able to use a live, hosted “last‑good” stats API (Path B+). The file path (`stats-path`) remains a safe fallback for OSS/local, but the recommended Team path is to point the Action at a hosted GET endpoint and pass a bearer token via GitHub Actions secrets.

## Default hosted endpoint (Saiyam’s Worker)

For the project’s current hosted deployment, the default base URL is:

```
https://nock.saiyamshah1496.workers.dev
```

Endpoint shape:
- `GET /v1/stats/:repoId` — returns plaintext JSON “last‑good” snapshot for that `repoId`
- `POST /v1/stats/:repoId` — accepts plaintext in dev mode or an encrypted envelope (see below)

Example repo id: `my-repo` → `https://nock.saiyamshah1496.workers.dev/v1/stats/my-repo`

Note: This is Saiyam’s current Worker. A future multi‑tenant product would provision per‑customer URLs; until then this endpoint is the project’s hosted path.

## Action inputs (on `main`)

From `packages/action/action.yml`:
- `stats-api-url` (optional): GET URL for hosted stats (Path B+)
- `stats-api-token` (optional): Bearer token for hosted stats API
- `stats-path` (optional): file fallback `.nock/stats.json`

Behavior:
- If `stats-api-url` is present, the Action attempts a GET with `Authorization: Bearer <stats-api-token>` and uses the result.
- If the GET fails or is unset, it falls back to reading `stats-path` on disk.

## Required secrets (names only; never commit values)

- `NOCK_STATS_API_TOKEN` — bearer token used by the Action (GET) and by sync jobs (POST).
- `NOCK_STATS_KEK` — base64 32‑byte key for envelope encryption when pushing stats to the API in production.

Put these in your repository’s “Actions secrets and variables” page. Do not commit any secret values.

## Recommended wiring

1) In PR workflows using the Action, set:
   - `stats-api-url: https://nock.saiyamshah1496.workers.dev/v1/stats/<your-repo-id>`
   - `stats-api-token: ${{ secrets.NOCK_STATS_API_TOKEN }}`
   - Keep `stats-path: .nock/stats.json` as a fallback for OSS/local.

2) Optionally run a scheduled sync that:
   - Calls `nock sync-stats --database-url "$PG_STATS_URL" --out .nock/stats.json`
   - Pushes to `POST /v1/stats/<your-repo-id>` with:
     - `--push-url "https://nock.saiyamshah1496.workers.dev/v1/stats/<your-repo-id>"`
     - `--token "$NOCK_STATS_API_TOKEN"`
     - `env: NOCK_STATS_KEK: ${{ secrets.NOCK_STATS_KEK }}` (omit only in local plaintext dev mode)

## Security notes

- Production pushes must encrypt snapshots: provide `NOCK_STATS_KEK` (base64 32 bytes). Local plaintext dev mode sets `NOCK_DEV_PLAINTEXT_STATS=1` and should not be used in CI.
- The Worker stores either plaintext (dev mode) or an AES‑GCM envelope. The GET path always returns plaintext JSON to the Action after server‑side decryption.

## Rationale

- Keeps the Action simple and fast (GET last‑good on every PR).
- Allows customers to run sync separately (replica, least‑privilege role) and avoid committing stats to git.
- Falls back gracefully to a local file for OSS/local flows.

