# Catalogue-aware consumers: R008 and R009

Context: follow-on to `025-catalogue-consumers-r022-r023-r007.md`. This note documents catalogue-aware deepening for R008 and R009 on the existing Phase 1 estate.

Scope:
- R008 — ALTER COLUMN … TYPE …: when the governance catalogue `columns[]` section is present, use `columns[].type_name` as the source type to soften false “rewrite-likely” alarms for known-safe widens:
  - integer → bigint
  - float4/real → float8/double precision
  - varchar(n) → varchar(m) with m ≥ n, or → text
  The soften applies only when catalogue is present and the specific column matches; omit (`columns` key absent) fails closed and keeps today’s R008 behavior. A policy knob `rules.R008.soften_with_catalogue` (default: true) disables the soften when set to false.

- R009 — DROP/RENAME advisory: keep the default yellow advisory, and add two catalogue-aware escalation arms (default ON):
  1) DROP CONSTRAINT on a PK/UNIQUE that is the replication identity path for the table (`tables[].replica_identity = 'd'` for primary key or `'i'` for a chosen unique index) emits a stronger advisory mentioning the replica identity. Optional knob `rules.R009.red_on_drop_replica_identity` (default: false) upgrades the advisory to red.
  2) DROP COLUMN when the column still appears in `constraints[].columns` or `indexes[].columns` escalates the advisory with a dependency-aware remediation hint (no expression text). Optional knob `rules.R009.escalate_drop_column_dependencies` (default: true) can disable this escalation.

Physics:
- Omit vs empty: Omitting a catalogue section key fails closed for these new arms. Present-but-empty `[]` means “synced; none found” and does not match.
- No new rule IDs; public titles remain R008/R009. `n_live_tup` accounting is unchanged.

