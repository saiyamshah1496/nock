# 001 — Parser (Phase 1 shape matchers)

Goal: Parse just enough Postgres DDL to power R001–R012 without blocking the wedge.

Options
- Shape matchers (regex/AST-lite) for a small set of DDL: fast to ship, easy to audit.
- libpg-query (WASM) full parse from day 1: higher fidelity, slower to integrate; risk on build size and cold start.
- Shell out to `pg_query`: external dep, portability issues in CI/Action.

Pros/cons
- Shape matchers: +GTMs fastest, +small deps; −edge-case coverage, −dialect quirks.
- WASM: +coverage; −time risk, −bundle/CI friction.
- Shell out: −portability, −security, −latency.

Decision
- Phase 1: shape matchers for CREATE INDEX (±CONCURRENTLY), ALTER TABLE … ADD COLUMN (nullable/constant default), SET NOT NULL, ADD CHECK/NOT VALID, ADD FK/NOT VALID, ALTER TYPE, DROP/RENAME, VACUUM FULL/REINDEX/CLUSTER.
- Unknown DDL becomes YELLOW (never silent green).
- Plan Phase 2: add libpg-query WASM gate without changing product contract.

Acceptance criteria
- R001, R004, R006, R010 matchers pass fixtures.
- Unrecognized DDL produces YELLOW with clear message.
- Lock taxonomy correct: non-concurrent CREATE INDEX = SHARE.

