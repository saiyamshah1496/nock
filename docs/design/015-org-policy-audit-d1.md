## 015 — Org policy store + audit on D1 (Workers)

Note: Migration 0002 (Team audit enrichment) adds optional columns on `audit_events`:
- `estate_captured_at TEXT NULL`
- `freshness TEXT NULL` — values `fresh` | `warn` | `stale` | `missing`
- `rule_hits_json TEXT NULL` — array of `{id, severity, table, n_live_tup, reason_code}` (no full SQL stored)
See Staff DB design reference “022-team-data-plane” for broader context (owned by Staff DB).

### Overview

- Store versioned org/repo policy packs and append-only audit events in Cloudflare D1.
- Keep encrypted stats blobs in R2 (already live) — unchanged.
- Expose minimal API routes on `@nockhq/api`:
  - `GET /v1/policy/:repoId` (fallback to org default)
  - `PUT /v1/policy/:repoId` (auth; version bump)
  - `POST /v1/audit` (auth; append-only)
  - `GET /v1/audit/:repoId?limit=N` (recent)
- Action integration:
  - Optionally GET hosted policy and override/merge local file (precedence: org hosted > local file).
  - Always POST audit when API URL + token present.

### Auth

- Reuse the existing bearer `NOCK_STATS_API_TOKEN` for v1 across stats, policy, and audit.
  - Rationale: single-secret GTM speed, no multi-tenant RBAC in scope; endpoints are narrow and non-destructive (policy is versioned-only; audit is append-only).
  - Future: scoped API keys per repo/org; separate token for read-only policy GET if desired.

### Identifiers

- `repoId`: expected `owner/repo`. If `:`-param lacks `/`, an optional header `x-nock-org-id` or query `?orgId=...` may supply org fallback. If neither provided, org fallback is skipped.
- `orgId`: by default, `owner` from `owner/repo`.

### Data model (D1)

- Table: `policies`
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `org_id TEXT NOT NULL`
  - `repo_id TEXT NULL` — NULL means org default
  - `version INTEGER NOT NULL`
  - `body_json TEXT NOT NULL` — canonical JSON form of the pack
  - `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - Unique: `(org_id, repo_id, version)`
  - Index: `(org_id, repo_id, created_at DESC)`

- Table: `audit_events`
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `org_id TEXT NOT NULL`
  - `repo_id TEXT NOT NULL`
  - `sql_hash TEXT NOT NULL` — e.g. `sha256:<hex>`
  - `verdict TEXT NOT NULL` — `pass`|`fail`
  - `rule_ids_json TEXT NOT NULL` — JSON array of rule IDs (e.g. `["R001","R010"]`)
  - `policy_version INTEGER NULL`
  - `actor TEXT NULL` — GitHub actor/login or token label
  - `ci_run_id TEXT NULL` — e.g. `${GITHUB_RUN_ID}` or `<owner>/<repo>#<pr>:<run>`
  - `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
  - Index: `(repo_id, created_at DESC)`

- Retention: prune audit events older than 30 days (Team default). Implementation: opportunistic delete on `POST /v1/audit`. Tunable via env `NOCK_AUDIT_RETENTION_DAYS` (default 30).

### API

- Common helpers:
  - Authorization: `Authorization: Bearer <NOCK_STATS_API_TOKEN>`
  - JSON error envelope: `{ error: string }`

- `GET /v1/policy/:repoId` (URL-encode `owner/repo` as `owner%2Frepo`)
  - Behavior:
    1. Try repo-scoped latest by `(org_id, repo_id)` with max(version).
    2. If missing, and `orgId` is known, return org default `(org_id, repo_id IS NULL)` latest.
    3. Else 404.
  - Response 200: the stored `body_json` parsed to object.
  - Auth: required (same bearer).

- `PUT /v1/policy/:repoId`
  - Auth required. Body: JSON or YAML of a policy pack (server accepts both; stores canonical JSON).
  - Version bumps atomically: `next = COALESCE(MAX(version),0)+1` for `(org_id, repo_id)`.
  - Optional query/header `?orgId=`/`x-nock-org-id:` to override owner-part-inferred org when `repoId` lacks `/`.
  - Response 200: `{ status: "ok", version: <int> }`.

- `POST /v1/audit`
  - Auth required. Body JSON:
    ```
    {
      org_id: string,           // required
      repo_id: string,          // required
      sql_hash: string,         // required (do not send full SQL)
      verdict: "pass"|"fail",   // required
      rule_ids: string[],       // required
      policy_version?: number,
      actor?: string,
      ci_run_id?: string
    }
    ```
  - Server stores `rule_ids_json = JSON.stringify(rule_ids)`.
  - Returns `{ status: "ok" }`. Opportunistically prunes old rows per retention setting.

- `GET /v1/audit/:repoId?limit=N` (URL-encode `owner/repo`)
  - Returns recent events for repo (default `limit=50`, max 200).
  - Response: `[{ id, org_id, repo_id, sql_hash, verdict, rule_ids: string[], policy_version, actor, ci_run_id, created_at }]`

### Workers binding (wrangler)

Example (do not commit secrets/ids):

```toml
name = "nock"
main = "src/worker.ts"
compatibility_date = "2026-09-15"
compatibility_flags = ["nodejs_compat"]

[vars]
# NOCK_STATS_STORE = "r2"
# NOCK_DEV_PLAINTEXT_STATS = "1"
# NOCK_AUDIT_RETENTION_DAYS = "30"

[[d1_databases]]
binding = "NOCK_D1"
database_name = "nock-team"
database_id = "00000000-0000-0000-0000-000000000000" # fill in on Cloudflare
migrations_dir = "d1/migrations"
```

Migration `d1/migrations/0001_init.sql` creates `policies` and `audit_events` as above.

### Local/dev + tests

- Tests must pass without a Cloudflare account. Provide an in-memory store implementing the same interface used by routes.
  - `InMemoryPolicyAuditStore` for `vitest`.
  - Workers D1 only used in production deploys.
- Local Node server (`packages/api/src/server.ts`) wires file-backed stats store (existing) + in-memory policy/audit store by default.

### Action integration

- Policy precedence:
  1. Hosted org/repo policy from API (if API URL + token provided)
  2. Local `policy.default.yml` (repo file)
  - Merge strategy v1: hosted JSON replaces local entirely (documented). Later: `extends:` layering.
- After computing verdict, POST `/v1/audit` when API base URL + token present:
  - `org_id` = `${owner}`
  - `repo_id` = `${owner}/${repo}`
  - `sql_hash` = `sha256` of concatenated migration SQL (do not send raw SQL)
  - `rule_ids` = unique set from `verdict.violations[].rule_id`
  - `policy_version` from hosted pack if available; else omit.
  - `actor` = GitHub actor; `ci_run_id` = `${GITHUB_RUN_ID}`.

### Security notes

- Do not store full migration SQL in cloud. Only `sql_hash` (and optionally very short client-side preview in the Action log/PR comment, not persisted server-side).
- No DSNs, no table row data in D1.
- Bearer token reused for v1; rotate regularly; prefer repo-scoped keys in Phase 3.

### Success criteria

- Design doc committed.
- D1 schema + example wrangler config added.
- Routes implemented behind `@nockhq/api` Workers app.
- Local tests using in-memory store; `pnpm -r build && pnpm test` green.
- Action updated to GET policy (optional) and POST audit (when configured).

