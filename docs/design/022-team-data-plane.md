## 022 — Team thin‑slice data‑plane (Locked)

Status: Accepted (PL locked) · Audience: engineering · Owner: Staff DB (semantics) + Founding Engineer (Worker)  
Scope: data‑plane only (no control‑plane changes, no D1 SQL in this PR)

### Goal
Document the locked Team thin‑slice data‑plane contract and add shared types used across packages. This design reuses live shapes on main and routes already in production:
- Estate JSON: reuse existing fixture/`EstateSnapshot` shape
- Envelope encryption: reuse `@nockhq/secure-estate` EnvelopeV1
- Push path: existing `POST /v1/estate/:repoId` (URL‑encoded `owner/repo`)
- Policy: single canonical schema identical to `policy.default.yml`
- Audit: append‑only, add rule hit detail and freshness metadata (document columns; FE ships migration)

Partner‑facing copy: “Bring your own estate / Sync estate yourself / Nock Team” — not Path A/B/C in public docs.

### Non‑goals
- No Worker/CLI/Action behavior changes in this PR
- No new identifiers (no `:estate_id` path); Team v1 keys by `:repoId`
- No D1 migration in this PR (document additive columns only)
- No alternative policy schema

---

### Estate JSON — reuse (locked)

Canonical estate snapshot equals today’s `.nock/estate.json` fixtures and `EstateSnapshot` in `@nockhq/core`:

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "source": "sync-estate",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 100 }
  ]
}
```

Team requirements:
- `captured_at`: required on Team push; reject if missing/unparseable
- Hot input for all size‑gated rules is `tables[].n_live_tup`
- No row data, no DSN/credentials in payload

References:
- Fixtures: `fixtures/estate_tiny.json`, `fixtures/estate_billion.json`
- Type: `packages/core/src/index.ts` (`EstateSnapshot`)

---

### Push path — reuse existing route

- Client flow: `nock sync-estate` writes local `.nock/estate.json` → encrypts → `POST /v1/estate/:repoId`
- Live route: `POST /v1/estate/:repoId` and `GET /v1/estate/:repoId` (see `packages/api/src/app.ts`)
- Auth: single global bearer token (`NOCK_ESTATE_API_TOKEN`, fallback `NOCK_STATS_API_TOKEN`)
- Storage key (Worker/R2): `estate/{sanitized(repoId)}/last.envelope.json`
- Team v1 identifier: `estate_id ≡ repoId` (016 multi‑DB deferred; do not introduce a new `:estate_id` path)

EnvelopeV1 (from `@nockhq/secure-estate`) is used as‑is:
```json
{
  "version": "v1",
  "payload": { "ct": "<b64>", "iv": "<b64>", "tag": "<b64>" },
  "dek":     { "ct": "<b64>", "iv": "<b64>", "tag": "<b64>" },
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "source": "sync-estate"
}
```
Crypto model (design‑partner phase): Nock‑held KEK. Worker decrypts for GET/check/export. No plaintext on hosted. Client encrypts.

---

### Freshness bands (locked numbers)

- Fresh: age ≤ 7 days — full size‑gating
- Warn: 7d < age ≤ 30d — full size‑gating + emit yellow `estate_stale_warn` (does not fail alone unless `fail_on: yellow`)
- Stale → Neutral: age > 30d — size‑gated rules follow `no_stats` path; non‑size rules still apply; emit `estate_stale_neutral`
- Missing: no estate — existing Neutral / `no_stats`
- Push skew guard: reject Team push if `captured_at` > server clock + 1 hour (or missing/unparseable on Team push)

Shared helper: `computeFreshness(capturedAt, now?) → "fresh" | "warn" | "stale" | "missing"` with constants
`FRESHNESS_WARN_MS` (7d), `FRESHNESS_STALE_MS` (30d), `PUSH_SKEW_MS` (1h).

---

### Policy — one canonical schema (locked)

- Hosted policy JSON stored in D1 is identical to `policy.default.yml` resolved JSON (see root `policy.default.yml`)
- `check()` reads exactly that schema; hosted ≡ file parity tests are required (follow‑up PR)
- Routes unchanged: `GET/PUT /v1/policy/:repoId`

---

### Audit — reuse 015 + Team additions (document only here)

Keep existing columns from 015 (D1 `0001_init.sql`):
- `org_id`, `repo_id`, `sql_hash`, `verdict` (`pass`|`fail`), `rule_ids_json`, `policy_version`, `actor`, `ci_run_id`, `created_at`
- Never store full SQL; `sql_hash` only

Additive columns for FE’s `0002` migration (documented here; not landed in this PR):
- `estate_captured_at TEXT NULL` — snapshot clock used for the run
- `freshness TEXT NULL` — one of `"fresh" | "warn" | "stale" | "missing"`
- `rule_hits_json TEXT NULL` — richer detail than ids (shape below)

Rule hit shape (export/detail), no full SQL:
```json
{ "id": "R010", "severity": "red", "table": "sessions", "n_live_tup": 1234567, "reason_code": "missing_lock_timeout" }
```

Exports:
- Estate export = plaintext JSON identical to input (decrypt on GET)
- Audit export = JSONL stream of recent rows; `rule_hits_json` is included when available

---

### Partner‑facing copy (public docs)

- Bring your own estate — commit or upload `.nock/estate.json`
- Sync estate yourself — run `nock sync-estate` on your runner and push to Nock
- Nock Team — hosted decrypt + policy/audit with the same schema as file mode

Avoid Path A/B/C labels in public prose; use them only in internal design references.

---

### PR split / sequencing

This PR:
- Adds this design doc
- Adds shared types and a pure `computeFreshness` helper + unit tests in `@nockhq/core` (re‑exported from package entry)

Follow‑ups:
- Policy parity tests (hosted JSON ≡ file ≡ `check()`)
- CLI push/freshness enforcement and Action messaging
- Audit enrichment/write path, coordinated with FE landing D1 `0002`

---

### References

- 008 — sync‑estate (`docs/design/008-sync-stats.md`)
- 009 — thin hosted estate API (`docs/design/009-hosted-stats-api.md`)
- 015 — org policy store + audit on D1 (`docs/design/015-org-policy-audit-d1.md`)
- 016 — estate naming and multi‑DB (`docs/design/016-estate-naming-and-multi-db.md`)
- Policy pack (`policy.default.yml`)
- D1 schema init (`packages/api/d1/migrations/0001_init.sql`)
