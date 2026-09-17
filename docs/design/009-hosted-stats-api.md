## 009 — Thin hosted encrypted estate API (Path B+)

Audience: engineering. Status: proposed → implement in this PR. Scope: Path B+ only. Path C (hosted pull/DSN), Stripe, dashboard, GitHub App are out-of-scope for code — document only.

### Goal
Add a minimal hosted API that accepts pushed Postgres estate snapshots from customers (Path B+) and serves “last-good” estate back to CI. Optimize for GTM speed and local testability:
- Local dev runs without Fly/R2 accounts.
- Envelope encryption supported for production; plaintext dev mode guarded by an env var for local only.
- Simple bearer token auth for MVP.

### Surfaces
- POST `/v1/estate/:repoId` — accept a ciphertext envelope (production) or plaintext JSON (dev only).
- GET `/v1/estate/:repoId` — return last-good plaintext estate for that repoId.
- GitHub Action can optionally fetch from API before falling back to an `estate.json` path.
- CLI `nock sync-estate` can optionally push to the API after writing a local file.

---

### Hosting choice
- Option A: Fly.io + R2 (object store)
  - Pros: easy global edge, persistent object storage.
  - Cons: requires accounts/creds to run; heavier to test locally.
- Option B: Local-only (skip host for dev), with clear doc for Fly/R2 later
  - Pros: zero external deps; fastest iteration; CI-friendly; enables green tests w/o cloud.
  - Cons: not production-grade durability/scalability out-of-the-box.

Decision: build local-first service (Node + Hono), file-based store behind an `EstateStore` interface. Document Fly/R2 later mapping. No real Fly/R2 provisioning in this PR.

---

### API design
Paths:
- `POST /v1/estate/:repoId`
  - Auth: `Authorization: Bearer <token>` (env: `NOCK_ESTATE_API_TOKEN`, falls back to `NOCK_STATS_API_TOKEN`).
  - Content:
    - Production (default): JSON envelope (see Encryption) with fields: `version`, `dek_{ct,iv,tag}`, `payload_{ct,iv,tag}`, plus metadata like `captured_at`, `schema_version`.
    - Dev plaintext mode: raw `EstateSnapshot` JSON when `NOCK_DEV_PLAINTEXT_ESTATE=1` (or legacy `NOCK_DEV_PLAINTEXT_STATS=1`) is set on the server (document: local-only).
  - Behavior: Store the last-good artifact atomically (envelope file or plaintext file). Optionally verify envelope by decrypting on receipt; on failure 400.
- `GET /v1/estate/:repoId`
  - In dev plaintext mode: return stored plaintext JSON.
  - Otherwise: read the envelope and decrypt with `NOCK_ESTATE_KEK` (falls back to `NOCK_STATS_KEK`), return plaintext JSON.
  - 404 if not present; 500 if decryption fails (misconfig).

Errors use concise JSON: `{ "error": "message" }`.

---

### Auth (MVP)
- Bearer token read from env (`NOCK_ESTATE_API_TOKEN`, falls back to `NOCK_STATS_API_TOKEN`); constant across repos for MVP.
- Pros: trivial, no external setup. Good enough to unblock early pilots.
- Cons: coarse-grained; rotation and per-repo tokens are future work.
- Future: GitHub App with repo scoping, JWT verification.

---

### Envelope encryption (MVP)
Objective: client encrypts, server stores and serves but can also decrypt for GET.

Production shape (documented, compatible with future KMS/HSM):
- KEK (Key Encryption Key): 256-bit symmetric key provided via env `NOCK_ESTATE_KEK` (falls back to `NOCK_STATS_KEK`) as base64. In production this would be a KMS-provided key; we model it as a static secret for MVP.
- DEK (Data Encryption Key): 256-bit random per-payload key.
- Algorithms: AES-256-GCM for both payload and DEK wrapping (pragmatic, widely available). AAD optional; omitted for MVP.

Envelope JSON (v1):
```json
{
  "version": "v1",
  "payload": { "ct": "<base64>", "iv": "<base64>", "tag": "<base64>" },
  "dek":     { "ct": "<base64>", "iv": "<base64>", "tag": "<base64>" },
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "source": "sync-estate"
}
```

Dev plaintext mode:
- Server env `NOCK_DEV_PLAINTEXT_ESTATE=1` (or legacy `NOCK_DEV_PLAINTEXT_STATS=1`) allows posting and serving raw `EstateSnapshot`.
- Clear docs: dev-only; do not enable on any hosted environment.

Implementation details:
- Node `crypto` AES-GCM (`createCipheriv`/`createDecipheriv`), 12-byte IVs, 32-byte keys, base64 encoding for transport.
- Separate small shared package `@nockhq/secure-estate` containing:
  - `envelopeEncrypt(snapshot, kekB64): EnvelopeV1`
  - `envelopeDecryptToSnapshot(envelope, kekB64): EstateSnapshot`
  - Types for `EnvelopeV1`
- API depends on this for verification/decrypt; CLI depends on it to encrypt before push.

---

### Storage (MVP)
- Interface `EstateStore` with methods to save/load last-good per `repoId`.
- Default impl: filesystem store at `data/estate/<repoId>/last.envelope.json` or `last.json` (plaintext mode). Root dir overridable via `NOCK_ESTATE_STORE_DIR` (falls back to legacy var).
- Atomic writes (`fs.rename` temp → final).
- Future: Adapter for R2/S3 (`R2EstateStore`) implementing same interface.

---

### CLI push
Extend `nock sync-estate`:
- Flags:
  - `--push-url <url>` (e.g., `http://localhost:8787/v1/estate/my-repo`)
  - `--token <bearer>` (Authorization header)
  - Optional `--repo <repoId>` only if we prefer base URL; decision: keep `--push-url` as full URL to reduce ambiguity.
- Behavior:
  - Always write local file first (`--out`).
  - If `NOCK_DEV_PLAINTEXT_ESTATE=1` (client side; legacy `NOCK_DEV_PLAINTEXT_STATS=1`) → POST plaintext JSON.
  - Else if `NOCK_ESTATE_KEK` present (or legacy) → encrypt with `@nockhq/secure-estate`, POST envelope JSON.
  - Else → error explaining to set dev plaintext or provide KEK when using `--push-url`.

---

### GitHub Action integration
- New optional inputs:
  - `estate-api-url`: full GET URL
  - `estate-api-token`: bearer token (optional if API allows public)
- Behavior:
  - If `estate-api-url` is set, GET first (with token if provided). If 200 and JSON parsed, use it as estate.
  - Otherwise fall back to `estate-path` file.
  - If `captured_at` present and older than 24h, emit a warning that the snapshot may be stale.

---

### Local development
- Install: `pnpm i`
- Run API: `NOCK_ESTATE_API_TOKEN=dev NOCK_ESTATE_KEK=$(openssl rand -base64 32) pnpm -w --filter @nockhq/api dev`
- Dev plaintext: add `NOCK_DEV_PLAINTEXT_ESTATE=1` and omit `NOCK_ESTATE_KEK`.
- Test push: `nock sync-estate --database-url ... --out .nock/estate.json --push-url http://localhost:8787/v1/estate/my-repo --token dev`
- Fetch in Action: set `estate-api-url` to the GET endpoint and `estate-api-token` if required.

---

### Cost / complexity (eng)
- Small API app (Hono) + small shared crypto package + filesystem store.
- CLI small extension for POST.
- Action addition is lightweight (one GET + fallback + staleness check).
- No external cloud dependencies in tests/CI.

---

### Decision
- Implement local-first API (`@nockhq/api`) with Hono, file store, bearer auth.
- Implement AES-GCM envelope in shared `@nockhq/secure-estate`; use `NOCK_ESTATE_KEK` (base64).
- Support strict dev plaintext mode behind `NOCK_DEV_PLAINTEXT_ESTATE=1`.
- Extend CLI to optionally push; extend Action to optionally fetch (with 24h staleness warning).

---

### Notes for later (document-only in this PR)
- Fly deploy: 1–2 shared CPU, Node 20, mount volume for store or switch to R2. Terminate TLS at Fly; bind Hono on 0.0.0.0.
- R2: bucket-per-env or prefix-per-repo; server-side encryption with bucket policies; KEK in KMS for DEK wrapping once we add managed keys.
- GitHub App: replace bearer with fine-grained JWT; derive `repoId` from installation context; rate-limit and audit logs.

