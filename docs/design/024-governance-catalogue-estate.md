## 024 — Governance catalogue in estate (Phase 1)

Audience: engineering. Status: implemented. Scope: additive governance catalogue for `sync-estate` and `EstateSnapshot` types.

### Goal
Extend the estate snapshot with governance‑relevant catalogue facts, not performance telemetry:
- tables[]: keep existing size fields and add `relkind` and `replica_identity`
- columns[]: `schema`, `table`, `column`, `not_null`, `type_name`, optional `has_default` (boolean only)
- constraints[]: `schema`, `table`, `name`, `kind` (check|fk|pk|unique|exclude|…), `validated`, `columns[]`, FK: `foreign_table` (qualified as `schema.table`) and `foreign_columns[]`, optional `supporting_index`
- indexes[]: `schema`, `table`, `name`, `unique`, `primary`, `valid`, `ready`, `live`, `immediate`, `columns[]` (names only, expressions omitted), `replica_identity`

Explicitly NOT stored: default expression text, CHECK/index expressions or predicates, row data, pg_stat_statements, bloat, partition graphs, RLS, triggers, publications.

### Omit vs empty
- Omitted top‑level keys (no `columns`/`constraints`/`indexes`) mean “catalogue absent” — a fail‑closed stance for future catalogue‑aware rules.
- Present but `[]` means “synced; none found”.
A helper `hasCatalogueSection(snapshot, section)` is exported from `@nockhq/core` to make this distinction explicit.

### Implementation
- `@nockhq/core` types extended with `EstateColumn`, `EstateConstraint`, `EstateIndex` and optional arrays on `EstateSnapshot`.
- `@nockhq/cli sync-estate` now runs governance‑only catalogue queries using `postgres`:
  - Tables: `pg_stat_user_tables` + `pg_class.relkind` + `pg_class.relreplident`
  - Columns: `pg_attribute` + `format_type`, omit defaults text (presence only)
  - Constraints: `pg_constraint`, map contype and column arrays; include FK target as `schema.table`; include `conindid` name when present
  - Indexes: `pg_index` + `pg_class`, column names via `indkey` → `pg_attribute`; expressions omitted; include `indisreplident`

Fixtures updated to include empty catalogue arrays. Docs updated (guides, SECURITY, GRANTs).

