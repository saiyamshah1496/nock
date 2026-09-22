import type { EstateSnapshot, EstateTable, EstateColumn, EstateConstraint, EstateIndex } from "@nockhq/core";
import fs from "fs";
import path from "path";
import postgres from "postgres";

export interface SyncTableRow {
  pg_version: string;
  schema: string;
  name: string;
  relid: number;
  relkind: string | null;
  replica_identity: "d" | "n" | "f" | "i" | null;
  n_live_tup: number | null;
  n_dead_tup: number | null;
  n_tup_ins: number | null;
  n_tup_upd: number | null;
  n_tup_del: number | null;
  seq_scan: number | null;
  idx_scan: number | null;
  last_analyze: string | null;
  last_autoanalyze: string | null;
  relation_bytes: number | null;
  total_bytes: number | null;
}

export interface SyncColumnRow {
  schema: string;
  table_name: string;
  column_name: string;
  not_null: boolean;
  type_name: string;
  has_default: boolean;
}

export interface SyncConstraintRow {
  schema: string;
  table_name: string;
  name: string;
  kind: string;
  validated: boolean;
  columns: string[] | null;
  foreign_table: string | null;
  foreign_columns: string[] | null;
  supporting_index: string | null;
}

export interface SyncIndexRow {
  schema: string;
  table_name: string;
  name: string;
  is_unique: boolean;
  is_primary: boolean;
  valid: boolean;
  ready: boolean;
  live: boolean;
  is_immediate: boolean;
  replica_identity: boolean;
  columns: string[] | null;
}

export function mapRowsToStats(parts: {
  tables: SyncTableRow[];
  columns: SyncColumnRow[];
  constraints: SyncConstraintRow[];
  indexes: SyncIndexRow[];
}): EstateSnapshot {
  const { tables: tableRows, columns: columnRows, constraints: constraintRows, indexes: indexRows } = parts;
  const capturedAt = new Date().toISOString();
  const pgVersion = tableRows[0]?.pg_version;
  const tables: EstateTable[] = tableRows.map((r) => ({
    schema: r.schema,
    name: r.name,
    n_live_tup: Number(r.n_live_tup ?? 0),
    n_dead_tup: r.n_dead_tup ?? undefined,
    n_tup_ins: r.n_tup_ins ?? undefined,
    n_tup_upd: r.n_tup_upd ?? undefined,
    n_tup_del: r.n_tup_del ?? undefined,
    relation_bytes: r.relation_bytes ?? undefined,
    total_bytes: r.total_bytes ?? undefined,
    relkind: r.relkind ?? undefined,
    replica_identity: (r.replica_identity as any) ?? undefined,
    last_analyze: r.last_analyze,
    last_autoanalyze: r.last_autoanalyze
  }));
  const columns: EstateColumn[] = columnRows.map((r) => ({
    schema: r.schema,
    table: r.table_name,
    column: r.column_name,
    not_null: !!r.not_null,
    type_name: r.type_name,
    has_default: r.has_default ? true : undefined
  }));
  const constraints: EstateConstraint[] = constraintRows.map((r) => ({
    schema: r.schema,
    table: r.table_name,
    name: r.name,
    kind: r.kind,
    validated: !!r.validated,
    columns: Array.isArray(r.columns) ? r.columns : [],
    foreign_table: r.foreign_table ?? undefined,
    foreign_columns: Array.isArray(r.foreign_columns) ? r.foreign_columns : undefined,
    supporting_index: r.supporting_index ?? undefined
  }));
  const indexes: EstateIndex[] = indexRows.map((r) => ({
    schema: r.schema,
    table: r.table_name,
    name: r.name,
    unique: !!r.is_unique,
    primary: !!r.is_primary,
    valid: !!r.valid,
    ready: !!r.ready,
    live: !!r.live,
    immediate: !!r.is_immediate,
    columns: Array.isArray(r.columns) ? r.columns : [],
    replica_identity: !!r.replica_identity
  }));
  return {
    schema_version: "1",
    captured_at: capturedAt,
    pg_version: pgVersion,
    source: "sync-estate",
    tables,
    columns,
    constraints,
    indexes
  };
}

const DEFAULT_TABLES_SQL = `
SELECT
  current_setting('server_version') AS pg_version,
  n.nspname AS schema,
  c.relname AS name,
  c.oid AS relid,
  c.relkind AS relkind,
  c.relreplident AS replica_identity,
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
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY s.n_live_tup DESC NULLS LAST;
`;

const DEFAULT_COLUMNS_SQL = `
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  a.attname AS column_name,
  a.attnotnull AS not_null,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name,
  a.atthasdef AS has_default
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE c.relkind IN ('r','p')
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY n.nspname, c.relname, a.attnum;
`;

const DEFAULT_CONSTRAINTS_SQL = `
WITH cons AS (
  SELECT
    n.nspname AS schema,
    c.relname AS table_name,
    co.conname AS name,
    co.contype AS contype,
    co.convalidated AS validated,
    co.conrelid AS conrelid,
    co.conkey AS conkey,
    co.confrelid AS confrelid,
    co.confkey AS confkey,
    co.conindid AS conindid
  FROM pg_constraint co
  JOIN pg_class c ON c.oid = co.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND c.relkind IN ('r','p')
)
SELECT
  schema,
  table_name,
  name,
  CASE contype
    WHEN 'c' THEN 'check'
    WHEN 'f' THEN 'fk'
    WHEN 'p' THEN 'pk'
    WHEN 'u' THEN 'unique'
    WHEN 'x' THEN 'exclude'
    ELSE contype::text
  END AS kind,
  validated,
  (
    SELECT array_agg(a.attname ORDER BY i)
    FROM unnest(conkey) WITH ORDINALITY AS k(attnum, i)
    JOIN pg_attribute a ON a.attrelid = conrelid
                       AND a.attnum = k.attnum
  ) AS columns,
  CASE WHEN contype = 'f' THEN
    (
      SELECT n2.nspname || '.' || c2.relname
      FROM pg_class c2
      JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE c2.oid = confrelid
    )
  END AS foreign_table,
  CASE WHEN contype = 'f' THEN
    (
      SELECT array_agg(a2.attname ORDER BY i)
      FROM unnest(confkey) WITH ORDINALITY AS fk(attnum, i)
      JOIN pg_attribute a2 ON a2.attrelid = confrelid AND a2.attnum = fk.attnum
    )
  END AS foreign_columns,
  (
    SELECT ic.relname FROM pg_class ic WHERE ic.oid = conindid
  ) AS supporting_index
FROM cons
ORDER BY schema, table_name, name;
`;

const DEFAULT_INDEXES_SQL = `
WITH idx AS (
  SELECT
    n.nspname AS schema,
    c.relname AS table_name,
    i.indexrelid AS indexrelid,
    ci.relname AS name,
    i.indisunique AS is_unique,
    i.indisprimary AS is_primary,
    i.indisvalid AS valid,
    i.indisready AS ready,
    i.indislive AS live,
    i.indimmediate AS is_immediate,
    i.indisreplident AS replica_identity,
    i.indkey AS indkey,
    c.oid AS relid
  FROM pg_index i
  JOIN pg_class ci ON ci.oid = i.indexrelid
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND c.relkind IN ('r','p')
)
SELECT
  schema,
  table_name,
  name,
  is_unique,
  is_primary,
  valid,
  ready,
  live,
  is_immediate,
  replica_identity,
  (
    SELECT array_agg(a.attname ORDER BY ord.i)
    FROM unnest(indkey) WITH ORDINALITY AS ord(attnum, i)
    LEFT JOIN pg_attribute a ON a.attrelid = relid AND a.attnum = ord.attnum
    WHERE ord.attnum > 0 -- skip expression elements (0)
  ) AS columns
FROM idx
ORDER BY schema, table_name, name;
`;

export async function runSyncStats(args: { databaseUrl: string; sqlFilePath?: string }): Promise<EstateSnapshot> {
  const { databaseUrl, sqlFilePath } = args;
  const tablesSqlText = sqlFilePath ? fs.readFileSync(path.resolve(sqlFilePath), "utf8") : DEFAULT_TABLES_SQL;
  const sql = postgres(databaseUrl, {
    max: 1
    // ssl: rely on URL options like ?sslmode=require to support managed PG defaults
  });
  try {
    // Tables
    const trows = (await sql.unsafe(tablesSqlText)) as SyncTableRow[];
    // Columns / constraints / indexes — always use defaults (tuned for governance-only data; never store expressions)
    const crows = (await sql.unsafe(DEFAULT_COLUMNS_SQL)) as SyncColumnRow[];
    const conrows = (await sql.unsafe(DEFAULT_CONSTRAINTS_SQL)) as SyncConstraintRow[];
    const irows = (await sql.unsafe(DEFAULT_INDEXES_SQL)) as SyncIndexRow[];
    return mapRowsToStats({ tables: trows, columns: crows, constraints: conrows, indexes: irows });
  } finally {
    await sql.end({ timeout: 0 });
  }
}

