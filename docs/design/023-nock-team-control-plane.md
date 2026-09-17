## 023 — Nock Team control plane (platform) — draft

This note covers the control-plane work for Nock Team. It references the data-plane spec in 022 (owned by Staff DB). Do not re-define estate, encryption, policy, or audit shapes here — treat them as contracts defined in 022.

- Reference: `docs/design/022-team-data-plane.md` (Staff DB; defines estate push, EnvelopeV1, freshness, policy ≡ `policy.default.yml`, audit contents, and export shapes/JSONL). Landed in #35, with audit enrichment migration 0002 landed in #34, and freshness behavior in #36.
- Status: Docs-only. No API implementation in this PR. Ready for review.

---

### 1) Scope (control plane)

- Partner organizations and hashed API tokens (augment/replace the single global bearer).
- Surfacing exports if 022 does not already define them:
  - `GET /v1/export/estate/:repoId` (envelope|plaintext)
  - `GET /v1/export/audit/:repoId` (JSONL/NDJSON)
- Wire Action, App, and CLI to prefer hosted estate + policy by token (single engine parity: CLI ≡ Action ≡ MCP ≡ App).
- Call out current gaps vs the live Worker and sequencing after 022 lands.
- Bake Product Lead freshness policy locks into surfaces and API semantics (see §3.4).

Non-goals (remain out of scope): Stripe/billing, Path C (customer DSN pull), natural-language rules, partner-authored matchers, marketplace, deeper multi‑DB estate_id modeling, R011.

---

### 2) Live constraints (landed on main)

- API routes:
  - Estate routes use `/v1/estate/:repoId` where `:repoId` is `owner/repo`. The R2 layout today is effectively `estate/{id}/last.envelope.json` (sanitized from `owner/repo`).
  - Policy/audit routes exist per 015: `GET/PUT /v1/policy/:repoId`, `POST /v1/audit`, `GET /v1/audit/:repoId`.
- D1 schema:
  - v0001 (015) shipped `policies` and baseline `audit_events`.
  - 0002 audit enrichment (e.g., `rule_hits` and related fields) landed in #34 and is applied on live `nock-team`.
- Auth:
  - Single `NOCK_STATS_API_TOKEN` (or `NOCK_ESTATE_API_TOKEN`) bearer today, shared across surfaces. No partner org scoping yet.

---

### 3) Control-plane design

3.1 Partner orgs and hashed API tokens

- Minimal D1 tables (control-plane owned). If 022 introduces overlapping tables, prefer 022 canonical forms.

```
-- Organizations (control of token scope)
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,                  -- e.g. "acme-inc"
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Partner tokens (bearers hashed-at-rest)
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,                  -- ulid/uuid
  org_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,             -- sha256(base64(token))
  label TEXT NULL,                      -- "ci", "staging", etc.
  created_by TEXT NULL,                 -- staff login
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NULL,
  revoked_at TEXT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);
CREATE INDEX idx_tokens_org ON tokens(org_id);
```

Token behavior:
- On request: compute SHA‑256 of presented token, look up `tokens.token_hash` with `revoked_at IS NULL`. Attach `org_id` to request context.
- Backward compatibility: if `NOCK_STATS_API_TOKEN` env is set and matches the presented token, accept and treat as single‑tenant (no org scoping) for Phase 1 partners.
- Rotation/revocation: mark `revoked_at`; minting writes a new row; store `last_used_at` opportunistically on successful requests.

3.2 Export HTTP routes (per 022 contracts)

- `GET /v1/export/estate/:repoId?format=envelope|plaintext`
  - Auth: partner token.
  - Response: per 022 data-plane contracts (EnvelopeV1 for `envelope`, decrypted estate JSON for `plaintext` — same JSON shape as engine input).
  - Purpose: partner self‑service export for rollbacks and audits.
- `GET /v1/export/audit/:repoId?since=<iso>&until=<iso>&format=jsonl|json`
  - Auth: partner token.
  - Response: JSONL/NDJSON is the locked default; JSON array is optional. Each row shape as defined by 022 audit contracts (do not store raw SQL). 0002 enrichment fields are included where applicable.

3.3 Surface wiring (prefer hosted by token)

- GitHub Action (on `main` already partially wired):
  - Inputs remain: `estate-api-url`, `estate-api-token` (token is the partner bearer).
  - Derive API base from `estate-api-url` or `api-base-url`.
  - Prefer hosted policy via `GET /v1/policy/:repoId` with token; else fallback to `policy.default.yml`.
  - Always POST `/v1/audit` with token (shapes per 022).
  - Freshness (locked): warn if `captured_at` is older than 7 days; neutralize size‑gated checks if older than 30 days (see §3.4). App missing‑estate remains Neutral as already locked.

- CLI:
  - Add flags `--estate-api-url`, `--estate-api-token`, `--api-base-url` with env fallbacks.
  - Fetch hosted estate and policy first; fall back to local file if hosted is unavailable.

- MCP:
  - Mirror CLI env flags to maintain golden parity (CLI ≡ MCP).

- GitHub App:
  - Prefer fetching hosted estate+policy by an internal partner token (Worker-internal call) before falling back to repo Contents.
  - Keep PR comment and Checks behavior unchanged; only the data source changes when token present.
  - Freshness: same thresholds as Action — warn at >7d; at >30d, publish Neutral for size‑dependent findings; non‑size rules still apply; no‑estate path remains Neutral.

3.4 Freshness policy (locked — landed in #36)

These are product‑locked behaviors to be reflected in control‑plane surfaces and API semantics. 022 remains the contract source for data fields; this section specifies decisions and thresholds:

- Client/surfaces (Action, App, CLI, MCP):
  - Warning threshold: if `estate.captured_at` is older than 7 days, surface a warning about stale estate.
  - Neutralization threshold: if older than 30 days, treat size‑dependent gates as if stats are unavailable (“no_stats” path): size‑based rules (e.g., R001 thresholds, R010 size gates) should not cause a Fail; publish Neutral for those. Non‑size rules still evaluate and may Fail.
  - App “missing estate” behavior remains Neutral (unchanged).
- Server push guard:
  - `POST /v1/estate/:repoId` MUST reject when the client‑provided `captured_at` differs from server time by more than 1 hour (clock‑skew/antiquity guard). Return 400 with an explicit error.
  - For design partners, KEK is Nock‑held and disclosed; clients encrypt snapshots with the provided base64 32‑byte KEK (see 022 for envelope details).

---

### 4) Gaps vs live Worker today

- Auth is single‑bearer only; no per‑org tokens or hashing.
- Export endpoints not yet published in the Worker (control-plane to add endpoints conforming to 022).
- App does not yet prefer hosted fetch by token.
- R2 key layout currently uses repoId‑sanitized paths; update to the 022‑standardized org/repo layout where applicable.

---

### 5) Sequencing (022 landed in #35; 0002 in #34; freshness in #36)

`docs/design/022-team-data-plane.md` (Staff DB) is the source of truth for estate/envelope/policy/audit contracts and any D1/R2 keys it specifies. It has landed on main.

1) PR1 — Tokens + auth switch (control plane)
   - Add `orgs` and `tokens` tables, token hash validation, and env‑bearer fallback.
   - No route shape changes; only authorization changes.
2) PR2 — Export endpoints (if not defined by 022)
   - Implement `GET /v1/export/estate` and `GET /v1/export/audit` using 022 shapes (JSONL for audit).
3) PR3 — Surface wiring
   - Action/CLI/MCP/App prefer hosted by token; preserve file fallbacks; parity tests for verdict JSON.
   - Update freshness thresholds: Action/App show 7d warn; at >30d treat size‑dependent checks as Neutral; non‑size rules unchanged.
4) PR4 — Partner setup doc
   - Invite/mint token, KEK management pointer, example workflows; Product Lead copy‑check.
5) PR5 — Cleanup and adoption
   - Deprecate single global bearer for partners (keep for staff/dev), metrics for adoption.

---

### 6) Security and operations (control plane)

- Tokens hashed-at-rest; minimal PII (`created_by` optional).
- Audit retention policy is unchanged; pruning controlled by env (see 015). Export does not change retention.
- Do not store migration SQL; only hashes and rule sets from 022.
- Always prefer envelope transit + storage as per 022; plaintext only for dev.
- KEK: for design partners, KEK is Nock‑held and disclosed to partners for envelope encryption during the thin‑slice; production posture may differ.

---

### 7) Success

- A design partner’s PR check runs using hosted estate + org policy via token (no committed estate files).
- Partner can export their estate and audit log (JSONL) self‑service.
- Implementation is sequenced after 022 and references it for all data-plane contracts.
- This PR remains a draft and contains no API code.

