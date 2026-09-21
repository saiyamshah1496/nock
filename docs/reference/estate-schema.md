# Estate schema (Phase‑1)

An estate is a small JSON snapshot of your Postgres tables’ sizes and governance facts (columns, constraints, indexes) that Nock uses to reason about locks and risk on your actual data. It is not a dump — no row contents, no passwords, and no stored SQL/expressions.

Minimal shape (Phase‑1 catalogue; additive sections):

```json
{
  "schema_version": "1",
  "captured_at": "2026-09-16T05:00:00Z",
  "pg_version": "16.4",
  "tables": [
    { "schema": "public", "name": "sessions", "n_live_tup": 1040000000, "relkind": "r", "replica_identity": "d" }
  ],
  "columns": [
    { "schema": "public", "table": "sessions", "column": "id", "not_null": true, "type_name": "bigint" },
    { "schema": "public", "table": "sessions", "column": "archived_at", "not_null": false, "type_name": "timestamptz", "has_default": false }
  ],
  "constraints": [
    { "schema": "public", "table": "sessions", "name": "sessions_pkey", "kind": "pk", "validated": true, "columns": ["id"], "supporting_index": "sessions_pkey" }
  ],
  "indexes": [
    { "schema": "public", "table": "sessions", "name": "sessions_pkey", "unique": true, "primary": true, "valid": true, "ready": true, "live": true, "immediate": true, "columns": ["id"], "replica_identity": true }
  ]
}
```

Omit vs [] semantics: omitting a section key means “catalogue absent” (catalogue‑aware rules fail‑closed); a present‑but‑empty `[]` means “synced; none found”.

Related:
- [Grants for sync-estate](../guides/grants-sync-estate.md)
- [CLI reference](./cli.md)

