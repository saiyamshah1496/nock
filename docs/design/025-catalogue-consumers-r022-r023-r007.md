# Catalogue consumers: R022, R023, deepen R007

Context: Phase 1 catalogue sync landed; R005/R017 added catalogue-aware arms. This note documents the follow-on consumers:

- R022 — VALIDATE CONSTRAINT on hot table
- R023 — Invalid or not-ready index on touched table
- R007 — extra catalogue arm for missing FK supporting index

## Semantics

General catalogue rules follow “omit = fail‑closed; [] = synced none”.
Size gates use primary table size (`n_live_tup`). Extra/soften arms default ON.

### R022 — VALIDATE CONSTRAINT on hot table

- Detect `ALTER TABLE <tbl> VALIDATE CONSTRAINT <name>`.
- Table resolution:
  - When `constraints[]` present, match by constraint `name` and use its `schema.table`; suppress when `validated: true`.
  - When `constraints` section is omitted, fall back to the table parsed from SQL (do not invent catalogue matches).
- Thresholds (knobs): `yellow_rows` (default 10k), `red_rows` (default 100k).
- Statement verdict: lock `SHARE UPDATE EXCLUSIVE`, `blocks_writes: true`.
- No-stats behavior: size‑gated red downgraded to yellow when `no_stats: warn`.

### R023 — Invalid or not-ready index on touched table

- After parsing the migration, collect tables “touched” by DDL (any statement with a `target` table).
- When `indexes[]` present for the estate, if any index on a touched table has `valid: false` or `ready: false`, emit a yellow R023 advisory.
- Omitted `indexes` section: do not run this arm (fail‑closed). Empty `[]`: no match.
- Knob: standard `enabled: false` disables the rule; default ON.

### R007 — ADD FOREIGN KEY without NOT VALID (extra catalogue arm)

- Keep existing size‑gated RED for `ADD FOREIGN KEY` without `NOT VALID` (default `red_rows: 100k`).
- New catalogue arm: when both `constraints[]` and `indexes[]` are present and the child FK columns have no covering supporting index on the same table (prefix/equal match on `indexes[].columns` with `valid && ready`), emit an extra YELLOW advisory with remediation:
  - `CREATE INDEX CONCURRENTLY ON <child>(<fk_columns>);`
- Omitted catalogue sections: no extra yellow (fail‑closed) — today’s R007 behavior only.

## Tests

Added unit tests covering:
- R022: match on large/medium estates, suppression when already validated, omit/empty semantics, knob-off.
- R023: match with `valid=false` or `ready=false`, omit/empty/mismatch, knob-off.
- R007: extra yellow only when catalogue present and no supporting index; prefix/equal index suppresses; pre-existing RED still fires on large tables.

## Policy

Defaults in `policy.default.yml`:
- `R022: { yellow_rows: 10000, red_rows: 100000 }`
- `R023: { severity: yellow }` (disable via `enabled: false`).

