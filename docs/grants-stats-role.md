# Grants for Nock sync-stats (Path B)

Purpose: create a least-privilege role that can run the `sync-stats` catalogue query (no table row data). Prefer connecting to a read replica.

Status: initial guidance. Managed providers vary; mark caveats as UNVERIFIED where noted. Validate on PG 14–16 in follow-up.

## Minimal role (illustrative)

```sql
-- Create a dedicated stats role (use stronger password / secret manager in practice)
CREATE ROLE nock_stats LOGIN PASSWORD 'REDACTED';

-- Allow connections to the target database
GRANT CONNECT ON DATABASE appdb TO nock_stats;

-- Allow usage on application schemas you want to inspect (or all non-system schemas)
GRANT USAGE ON SCHEMA public TO nock_stats;
-- Repeat for other schemas as needed, e.g.:
-- GRANT USAGE ON SCHEMA accounting, users TO nock_stats;

-- Grant SELECT on required catalogue / stats sources
-- UNVERIFIED: exact object-level GRANTs depend on provider defaults.
-- Many managed PGs allow these by default to all users:
--   pg_catalog.pg_class, pg_namespace, pg_stat_user_tables
-- Size functions (pg_relation_size/pg_total_relation_size) are callable without extra GRANTs.
```

Notes:
- Managed providers may restrict `pg_stat_activity` and `pg_locks` to superusers. This PR does not require them.
- Avoid granting table `SELECT` on application data — `sync-stats` does not read row data.
- Prefer replicas and network/IP allowlists when available.

## Connection examples

- Plain: `postgres://nock_stats:****@replica.example.com:5432/appdb`
- SSL (many managed PGs): `postgres://…/appdb?sslmode=require`

## Revocation

Rotate the role password periodically and `REVOKE CONNECT` / `DROP ROLE nock_stats` to disable.

