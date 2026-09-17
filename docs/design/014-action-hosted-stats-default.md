# 014 — GitHub Action with hosted estate (Path B+) as default

Status: Accepted

## Summary

Make the customer GitHub Action able to use a live, hosted “last‑good” estate API (Path B+). The file path (`estate-path`) remains a safe fallback for OSS/local, but the recommended Team path is to point the Action at a hosted GET endpoint and pass a bearer token via GitHub Actions secrets.

## Default hosted endpoint (Saiyam’s Worker)

For the project’s current hosted deployment, the default base URL is:

```
https://nock.saiyamshah1496.workers.dev
```

Endpoint shape:
- `GET /v1/estate/:repoId` — returns plaintext JSON “last‑good” snapshot for that `repoId`
- `POST /v1/estate/:repoId` — accepts plaintext in dev mode or an encrypted envelope (see below)

Example repo id: `my-repo` → `https://nock.saiyamshah1496.workers.dev/v1/estate/my-repo`

Note: This is Saiyam’s current Worker. A future multi‑tenant product would provision per‑customer URLs; until then this endpoint is the project’s hosted path.

## Action inputs (on `main`)

From `packages/action/action.yml`:
- `estate-api-url` (optional): GET URL for hosted estate (Path B+)
- `estate-api-token` (optional): Bearer token for hosted estate API
- `estate-path` (optional): file fallback `.nock/estate.json`

Behavior:
- If `estate-api-url` is present, the Action attempts a GET with `Authorization: Bearer <estate-api-token>` and uses the result.
- If the GET fails or is unset, it falls back to reading `estate-path` on disk.

## Required secrets (names only; never commit values)

- `NOCK_ESTATE_API_TOKEN` — bearer token used by the Action (GET) and by sync jobs (POST) — legacy `NOCK_STATS_API_TOKEN` accepted.
- `NOCK_ESTATE_KEK` — base64 32‑byte key for envelope encryption when pushing estate to the API in production — legacy `NOCK_STATS_KEK` accepted.

Put these in your repository’s “Actions secrets and variables” page. Do not commit any secret values.

## Recommended wiring

1) In PR workflows using the Action, set:
   - `estate-api-url: https://nock.saiyamshah1496.workers.dev/v1/estate/<your-repo-id>`
   - `estate-api-token: ${{ secrets.NOCK_ESTATE_API_TOKEN }}`
   - Keep `estate-path: .nock/estate.json` as a fallback for OSS/local.

2) Optionally run a scheduled sync that:
   - Calls `nock sync-estate --database-url "$PG_ESTATE_URL" --out .nock/estate.json`
   - Pushes to `POST /v1/estate/<your-repo-id>` with:
     - `--push-url "https://nock.saiyamshah1496.workers.dev/v1/estate/<your-repo-id>"`
     - `--token "$NOCK_ESTATE_API_TOKEN"`
     - `env: NOCK_ESTATE_KEK: ${{ secrets.NOCK_ESTATE_KEK }}` (omit only in local plaintext dev mode)

## Security notes

- Production pushes must encrypt snapshots: provide `NOCK_ESTATE_KEK` (base64 32 bytes). Local plaintext dev mode sets `NOCK_DEV_PLAINTEXT_ESTATE=1` and should not be used in CI.
- The Worker stores either plaintext (dev mode) or an AES‑GCM envelope. The GET path always returns plaintext JSON to the Action after server‑side decryption.

## Rationale

- Keeps the Action simple and fast (GET last‑good on every PR).
- Allows customers to run sync separately (replica, least‑privilege role) and avoid committing stats to git.
- Falls back gracefully to a local file for OSS/local flows.

