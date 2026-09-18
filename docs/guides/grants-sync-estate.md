# Grants for sync-estate

Purpose: create a least-privilege role that can run the `sync-estate` catalogue query (no table row data). Prefer connecting to a read replica.

Status: initial guidance. Managed providers vary; mark caveats as UNVERIFIED where noted. Validate on PG 14–16 in follow-up.

## What `sync-estate` reads (Phase‑1)

System catalogs and stats it selects from:
- `pg_catalog.pg_class`
- `pg_catalog.pg_namespace`
- `pg_catalog.pg_stat_user_tables`  — row count + vac stats (provider defaults vary; see notes)
- `pg_catalog.pg_attribute`         — columns (presence‑only `has_default`, never expression text)
- `pg_catalog.pg_constraint`        — PK/UNIQUE/FK/CHECK metadata (no expression text)
- `pg_catalog.pg_index`             — index metadata (column list, flags)

Functions it calls:
- Size functions: `pg_total_relation_size(oid)`, `pg_indexes_size(oid)` (and equivalents)

Not read:
- Table row data (no `SELECT ... FROM app_schema.table`)
- Default/CHECK/index expression text or generated column expressions

## Minimal role (illustrative)

```sql
-- Create a dedicated estate role (use stronger password / secret manager in practice)
CREATE ROLE nock_estate LOGIN PASSWORD 'REDACTED';

-- Allow connections to the target database
GRANT CONNECT ON DATABASE appdb TO nock_estate;

-- Allow usage on application schemas you want to inspect (or all non-system schemas)
GRANT USAGE ON SCHEMA public TO nock_estate;
-- Repeat for other schemas as needed, e.g.:
-- GRANT USAGE ON SCHEMA accounting, users TO nock_estate;

-- Catalog access (usually granted to PUBLIC by default)
-- Typically no explicit GRANT is needed for pg_catalog views:
--   pg_class, pg_namespace, pg_stat_user_tables, pg_attribute, pg_constraint, pg_index
-- Size functions (pg_total_relation_size / pg_indexes_size) are callable without extra GRANTs.

-- Managed PG quirk (UNVERIFIED across all providers):
-- If pg_stat_user_tables is restricted, grant stats reader:
--   GRANT pg_read_all_stats TO nock_estate;
```

Notes:
- Managed providers may restrict `pg_stat_activity` and `pg_locks` to superusers. Nock’s estate sync does not require them.
- Avoid granting table `SELECT` on application data — `sync-estate` does not read row data.
- Prefer replicas and network/IP allowlists when available.
- Some providers block `GRANT` on `pg_catalog` relations; rely on defaults in that case.

## Connection examples

- Plain: `postgres://nock_estate:****@replica.example.com:5432/appdb`
- SSL (many managed PGs): `postgres://…/appdb?sslmode=require`

## Revocation

Rotate the role password periodically and `REVOKE CONNECT` / `DROP ROLE nock_estate` to disable.

