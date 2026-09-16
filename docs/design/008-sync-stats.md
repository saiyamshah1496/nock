## 008 — sync-stats (Path B: customer-run sync)

Audience: engineering. Status: proposed → implemented in this PR. Scope: Path B only. Path C (hosted pull) and Stripe are explicitly out-of-scope.

### Goal
Add a CLI command `nock sync-stats` that connects to a customer-provided Postgres (ideally a read replica) using a least‑privilege stats role, executes the catalog query from architecture §9.2 / opportunity-1 §4.2, and writes a `stats.json` compatible with `@nock/core` and the existing fixtures. No table row data is read or written.

### Interface (CLI)

```
nock sync-stats \
  --database-url "$PG_STATS_URL" \
  --out .nock/stats.json \
  [--sql-file ./custom.sql]      # optional override later
```

Output JSON matches schema §6.1 in the architecture doc:

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "source": "sync-stats",
  "tables": [{ "schema":"public","name":"sessions","n_live_tup":1040000000, ... }]
}
```

### Catalog query (source of truth)
Exact SQL per Architecture §9.2 / Opportunity-1 §4.2 (do not add row data):

```sql
SELECT
  current_setting('server_version') AS pg_version,
  n.nspname AS schema,
  c.relname AS name,
  c.oid AS relid,
  s.n_live_tup,
  s.n_dead_tup,
  s.n_tup_ins,
  s.n_tup_upd,
  s.n_tup_del,
  s.seq_scan,
  s.idx_scan,
  s.last_analyze,
  s.last_autoanalyze,
  pg_relation_size(c.oid) AS relation_bytes,
  pg_total_relation_size(c.oid) AS total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_pretty
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY s.n_live_tup DESC NULLS LAST;
```

We surface only table‑level statistics (counts, sizes, last analyze) — no table row data and no full text queries.

### Driver choice
- Decision: use `postgres` (a.k.a. postgres.js).
- Rationale:
  - Zero dependency, fast, good DX with TypeScript.
  - Simple URL‑based connection (works with `postgres://…` and `?sslmode=require`).
  - Lightweight for a CLI that runs and exits; no pool complexity needed.
- Alternatives: `pg` (node-postgres) is mature and also fine; heavier surface, pooling defaults that we do not need for a single query. We can swap later with minimal surface impact since the collector is isolated in `@nock/cli`.

### Testing strategy (Path B)
- Unit test: pure mapping from query rows → `StatsSnapshot` (no DB required).
- Integration (optional): behind `NOCK_TEST_DATABASE_URL`. If set, run the exact query and assert basic shape. Skipped in CI when unset.
- Decision: do not add Docker Compose Postgres in this PR to keep CI deterministic. Future work: an opt‑in compose service can be added once it proves reliable across CI providers.

### Security and GRANTs (summary; full in docs/grants-stats-role.md)
- Prefer a **read‑only role** on a **replica**.
- Minimum privileges: CONNECT on DB, USAGE on schemas being inspected, and SELECT on catalog / stats views used above. Managed PG products vary — some block `pg_stat_activity` and `pg_locks`. This PR focuses on `pg_stat_user_tables` + size functions only.
- We never select table row data.

### Options considered

- Where to implement:
  - Chosen: implement collector in `@nock/cli` only, using types from `@nock/core`. Keeps `@nock/core` free of DB drivers and side‑effects.
  - Alternative: shared helper in `@nock/core`. Rejected for now to avoid shipping a DB client into surfaces that don’t need it (Action, MCP).

- Driver: `postgres` vs `pg`
  - Chosen: `postgres` for simplicity and small footprint.
  - `pg` remains a trivial swap if needed by customers later.

- Testing DB:
  - Chosen: require external DB via env for integration; no compose in CI.
  - Alternative: compose Postgres service. Deferred due to flakiness risks in shared CI and because Path A (file) remains always available.

### GTM notes
- README and `docs/DEVELOPMENT.md` call out Path A (file/paste) and Path B (customer sync) now; Path C (hosted pull) mentioned as future opt‑in only.
- Provide a scheduled GitHub Actions snippet that runs `nock sync-stats` and stores the JSON as an artifact (no secrets leaked in the example).

### Cost / complexity estimate (eng)
- Small, isolated CLI addition; one dependency (`postgres`).
- Unit test only requires pure mapping; integration is opt‑in.
- No impact on `@nock/core` or existing golden tests.

### Decision
- Implement `nock sync-stats` in `@nock/cli` using `postgres` driver, default SQL from §9.2, write `stats.json` with schema_version=1, captured_at, pg_version, source=sync-stats, and tables[]. No row data. Unit + optional integration tests included. README/docs wired; GRANTs doc added.

