# Rules reference

This page lists the current rule matrix enforced by Nock when evaluating Postgres DDL. Rules are catalogue- and estate-aware unless noted.

| Rule | Status | Notes |
|------|--------|-------|
| R001 — CREATE INDEX w/o CONCURRENTLY | Implemented | Lock mode SHARE; red ≥10k rows |
| R002 — CIC inside transaction | Implemented | Concurrent DDL cannot run inside explicit txn |
| R003 — ADD COLUMN … DEFAULT <volatile> (rewrite) | Implemented | Size-gated rewrite on volatile DEFAULT; do not red now() |
| R004 — ADD COLUMN nullable/constant-default on hot table w/o lock_timeout | Implemented (partial) | Size-gated; requires `lock_timeout`; constant-default nuance later |
| R005 — SET NOT NULL w/o validated CHECK | Implemented (catalogue-aware) | Red ≥100k; soften to yellow when fresh catalogue shows column already NOT NULL or a validated CHECK covering it. Fail‑closed when catalogue sections are omitted; present‑but‑empty arrays don’t match. |
| R006 — ADD CHECK w/o NOT VALID | Implemented | Red ≥50k rows |
| R007 — ADD FK w/o NOT VALID | Implemented (catalogue-aware) | Red ≥100k rows; remediate NOT VALID → VALIDATE. Extra yellow when catalogue present and no supporting index covers the FK child columns (prefix/equal) — remediate with CREATE INDEX CONCURRENTLY on the child columns. Omitted catalogue → today’s R007 only (fail‑closed). |
| R008 — ALTER TYPE non-binary-coercible | Implemented (catalogue-aware) | Yellow unknown; red when clearly rewriting (USING). Widen to text (unbounded) passes. When fresh catalogue is present, soften only true binary-coercible varchar widens relative to `columns[].type_name` — `varchar(n)→varchar(m≥n)` or `varchar(n)→text`. Omitted catalogue → today’s R008 only (fail‑closed). |
| R009 — DROP/RENAME | Implemented (catalogue-aware) | Yellow advisory; includes DROP COLUMN/CONSTRAINT, RENAME COLUMN/TABLE. When fresh catalogue is present: (a) dropping PK/UNIQUE that is the replica identity path (`tables[].replica_identity` = d/i) escalates with a stronger advisory (optional knob to make red); (b) dropping a column that still appears in `constraints[].columns`/`indexes[].columns` escalates with dependency-aware remediation. Omitted catalogue → today’s R009 only (fail‑closed). |
| R010 — DDL w/o lock_timeout on hot tables | Implemented (partial) | Applied to common DDL shapes |
| R011 — Live locks advisory | Out of scope |
| R012 — VACUUM FULL / non-concurrent REINDEX | Implemented | Always red in CI |
| R013 — REFRESH MATERIALIZED VIEW w/o CONCURRENTLY | Implemented | Red ≥10k rows; yellow if unknown size |
| R014 — ATTACH/DETACH PARTITION | Implemented | Yellow/red by size; notes on lock/scan |
| R015 — CIC w/o prior lock_timeout on hot table | Implemented | Yellow/red per size thresholds |
| R016 — Multiple AE DDLs on same hot table w/o lock_timeout | Implemented | Yellow advisory |
| R017 — ADD UNIQUE/PRIMARY KEY w/o USING INDEX | Implemented (catalogue-aware) | Red ≥10k; remediate CIC + USING INDEX. Suppress the red hit when a matching unique/primary, valid/ready/immediate index exists in the fresh catalogue with equal, order‑sensitive `columns[]`. Fail‑closed on omitted catalogue; empty/mismatch/invalid do not suppress. |
| R018 — ADD EXCLUDE constraint | Implemented | Size-gated red/yellow; no NOT VALID path |
| R019 — TRUNCATE on estate table | Implemented | Always red in CI policy |
| R020 — CLUSTER | Implemented | Always red in CI (R012 family) |
| R021 — CIC without explicit index name | Implemented | Yellow advisory |
| R022 — VALIDATE CONSTRAINT on hot table | Implemented | Yellow ≥10k rows; red ≥100k rows; catalogue-aware suppression when the matching constraint is already validated. Fallback to SQL table when constraints section omitted. |
| R023 — Invalid or not-ready index on touched table | Implemented | Default yellow when any `valid=false` or `ready=false` index exists on a table touched by the migration; fail‑closed when indexes section omitted. |
| R024 — Index density on large tables | Implemented | Estate-aware: on CREATE INDEX/CREATE INDEX CONCURRENTLY when the target table is large (≥100k rows or ≥64MiB when rows unknown) and existing index count exceeds a threshold (default 8). Neutralized when size facts are missing/stale. Optional downgrade to yellow via policy; shares `fail_on` with sibling index rules. |
| R025 — Write-heavy index maintenance cost | Implemented | Uses estate write counters `n_tup_ins`/`n_tup_upd`/`n_tup_del` (sum since stats reset). Yellow at ≥100k writes; red at ≥1M writes only when the table is also large (same large gates as R024). Neutralized when write counters are absent; never inferred from size alone. Optional severity yellow. Messages mention “since stats reset.” |
| R026 — Redundant / overlapping index | Implemented (catalogue-aware) | Detects exact-duplicate (order-sensitive) or left-prefix overlap for NON-UNIQUE btree indexes via `indexes[].columns[]`. Uniqueness matrix: existing UNIQUE covers new NON-UNIQUE same/prefix; existing NON-UNIQUE does not cover new UNIQUE; new UNIQUE only exact-matches existing UNIQUE. Skips indexes missing `columns[]` and expression-only indexes; INCLUDE columns ignored. Red when overlap and table is large; yellow otherwise. Optional severity yellow. |

See also:
- [CLI reference](./cli.md)
- [Verdict JSON](./verdict-json.md)
- [Estate schema](./estate-schema.md)

