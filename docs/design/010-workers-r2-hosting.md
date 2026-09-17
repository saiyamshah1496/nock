# 010 — Re‑lock hosting to Cloudflare Workers + R2 (Path B+)

Goal: Ship the thin hosted stats API (Path B+) with a default deployment target of Cloudflare Workers + R2. Prior PR 009 established a local‑first API with a filesystem store and documented Fly.io + R2 as a later mapping. This note re‑locks hosting to Cloudflare Workers + R2 as primary and keeps Fly as a backup option only.

## Decision

- Primary: Cloudflare Workers (edge runtime) + R2 (object storage via S3‑compatible API).
- Backup: Fly.io app serving the same Hono app, using the same R2 bucket (or local file store).
- Local dev remains file‑backed with zero external dependencies.

Rationale:
- Cost/ops: Workers request‑based pricing and R2 egress‑friendly storage keep steady‑state costs very low for a tiny API with infrequent writes/reads. No idle VM.
- DX/latency: Wrangler deploy is single command; global edge is a free win for the Action fetch path.
- Testability: Keep the file store for local tests; add an R2 adapter behind the same `StatsStore` interface. Use S3‑compatible signing (`aws4fetch`) to work both in Node and Workers.

## Architecture deltas

- `@nockhq/api` gains:
  - `R2StatsStore` implementing the same interface as `LocalFileStatsStore`, using S3‑compatible R2 over HTTPS.
  - A store factory selected by `NOCK_STATS_STORE` env var: `"file"` (default) or `"r2"`.
  - A Workers entrypoint that exports the Hono app for Wrangler (`export default app`).
- No production secrets are committed. Local defaults use the file store.

## Configuration

- Store selection:
  - `NOCK_STATS_STORE=file` (default) — use the filesystem store (local/dev/tests).
  - `NOCK_STATS_STORE=r2` — use the R2 adapter.
- Common API env:
  - `NOCK_STATS_API_TOKEN` — required bearer token for POST.
  - `NOCK_STATS_KEK` — base64 32‑byte key to decrypt/encrypt envelopes (omit only when `NOCK_DEV_PLAINTEXT_STATS=1` for local dev).
  - `NOCK_DEV_PLAINTEXT_STATS=1` — local dev only; sends/serves plaintext instead of envelopes.
- R2 adapter env:
  - `R2_ACCOUNT_ID` — Cloudflare account id.
  - `R2_ACCESS_KEY_ID` — R2 access key id.
  - `R2_SECRET_ACCESS_KEY` — R2 secret access key.
  - `R2_BUCKET` — bucket name.

Keys in R2 follow the file layout for parity: `stats/<repoId>/last.json` (plaintext) and `stats/<repoId>/last.envelope.json` (envelope), where `<repoId>` is sanitized to `[A-Za-z0-9._-]`.

## Workers vs Fly quick cost sketch (non‑binding)

- Workers: request‑metered; for a few pushes per day and Action fetches on PRs, monthly cost is typically negligible to low. No idle compute/VM hours.
- Fly: needs a VM allocation even when idle; smallest instances are inexpensive but non‑zero when idle. Adds volume management if using local disk.
- R2 storage: priced per GB/mo with generous egress waivers to Cloudflare properties; negligible for tiny JSON snapshots.

Conclusion: For GTM speed and steady‑state cost, Workers + R2 is the default. Keep Fly as a fallback for teams that already standardized on it.

## Deploy — Cloudflare Workers + R2

1) Create an R2 bucket and an API token (Access Key + Secret Key) with bucket‑limited permissions.
2) Add secrets/vars to your Workers project (via Wrangler):
   - `NOCK_STATS_STORE=r2`
   - `NOCK_STATS_API_TOKEN=<token>`
   - `NOCK_STATS_KEK=<base64-32-bytes>` (omit only when using plaintext dev)
   - `R2_ACCOUNT_ID=<your-account-id>`
   - `R2_ACCESS_KEY_ID=<access-key-id>`
   - `R2_SECRET_ACCESS_KEY=<secret>`
   - `R2_BUCKET=<bucket-name>`
3) Build the package:
   ```bash
   pnpm -r build
   ```
4) Configure `wrangler.toml` (see `packages/api/wrangler.toml.example`):
   - `main = "dist/worker.js"`
   - `compatibility_date = "2024-11-01"` (or current)
   - Add `vars` or use `wrangler secret put` for sensitive values.
5) Deploy:
   ```bash
   cd packages/api
   npx wrangler deploy
   ```

## Local dev and tests

- Default remains file store (`NOCK_STATS_STORE=file`), writing under `data/stats/` (override with `NOCK_STATS_STORE_DIR`).
- Workers build is committed but not required for local runs; Node entry continues to listen on `:8787` for quick curl testing.
- R2 adapter tests are skip‑by‑default unless `R2_*` env vars are present.

## Backup: Fly

- If needed, run the same `@nockhq/api` Node server on Fly. Keep storage on R2 via the same S3‑compatible adapter, or use the file store on an attached volume for non‑critical demos.
- This path is documented here as a fallback and is not required for GTM.

