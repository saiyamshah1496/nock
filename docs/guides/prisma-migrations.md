# Prisma migrations: CONCURRENTLY, transactions, and lock_timeout

Nock is check-only. It never applies or rewrites your SQL. These notes help you stage safer migrations when using Prisma Migrate with PostgreSQL.

## Concurrent DDL cannot run in a transaction (R002)

Postgres rejects concurrent operations inside an explicit transaction block:

- CREATE INDEX CONCURRENTLY
- CREATE UNIQUE INDEX CONCURRENTLY
- DROP INDEX CONCURRENTLY
- REINDEX CONCURRENTLY
- REFRESH MATERIALIZED VIEW CONCURRENTLY

Prisma Migrate typically wraps multi-statement migrations in a transaction. If your migration contains a CONCURRENTLY operation, ensure it does not get wrapped:

- Prefer a single-statement migration that contains only the concurrent statement.
- Or use Prisma’s per-migration “disable transaction” path for that file.

Example plan:

```sql
-- Migration A (single statement; not wrapped)
CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <schema>.<table>(<col(s)>);
```

Avoid placing any additional statements in the same Prisma migration that would cause a transaction wrapper.

## Set a fail-fast lock_timeout before CIC (R015)

Even with CONCURRENTLY, Postgres takes a very brief lock at the start. To avoid queuing behind long-running queries (which can make “non‑blocking” builds effectively block your app), set a short, fail‑fast lock timeout before running the CIC:

- Recommended: SET lock_timeout = '5s' (tune to your appetite)
- Do this at the session level or in a separate migration that runs before the CIC
- Prisma caveat: do not combine `SET lock_timeout` and the `CREATE INDEX CONCURRENTLY` in the same Prisma migration file (a multi‑statement migration can be wrapped in a transaction, which would break CIC)

Example plan:

```sql
-- Session or prior migration:
SET lock_timeout = '5s';

-- Separate migration (single statement):
CREATE INDEX CONCURRENTLY IF NOT EXISTS <index_name> ON <schema>.<table>(<col(s)>);
```

## After deploy: clean up invalid/not‑ready indexes (R023)

A failed concurrent build can leave an index that is INVALID (still maintained on every write) and/or not‑ready (planner won’t use it) — pure cost until dropped and rebuilt.

Verify and remediate:

```sql
-- Inspect index health on the affected table
SELECT i.relname AS index_name, idx.indisvalid, idx.indisready
FROM pg_index idx
JOIN pg_class i ON i.oid = idx.indexrelid
JOIN pg_class t ON t.oid = idx.indrelid
WHERE t.relname = '<table>';

-- If an index is INVALID, drop it without blocking writers
DROP INDEX CONCURRENTLY IF EXISTS <invalid_index_name>;

-- Recreate (prefer CONCURRENTLY)
CREATE INDEX CONCURRENTLY <index_name> ON <schema>.<table>(<col(s)>);
```

Notes:
- Keep CIC migrations outside explicit transactions.
- For Prisma, use a single‑statement migration or disable the transaction for that migration file.

