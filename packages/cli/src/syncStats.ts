import { type EstateSnapshot, type EstateTable } from "@nockhq/core";
import fs from "fs";
import path from "path";
import postgres from "postgres";

export interface SyncRow {
  pg_version: string;
  schema: string;
  name: string;
  relid: number;
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

export function mapRowsToStats(rows: SyncRow[]): EstateSnapshot {
  const capturedAt = new Date().toISOString();
  const pgVersion = rows[0]?.pg_version;
  const tables: EstateTable[] = rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    n_live_tup: Number(r.n_live_tup ?? 0),
    n_dead_tup: r.n_dead_tup ?? undefined,
    relation_bytes: r.relation_bytes ?? undefined,
    total_bytes: r.total_bytes ?? undefined,
    last_analyze: r.last_analyze,
    last_autoanalyze: r.last_autoanalyze
  }));
  return {
    schema_version: "1",
    captured_at: capturedAt,
    pg_version: pgVersion,
    source: "sync-estate",
    tables
  };
}

const DEFAULT_SQL = `
SELECT
  current_setting('server_version') AS pg_version,
  n.nspname AS schema,
  c.relname AS name,
  c.oid AS relid,
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

export async function runSyncStats(args: { databaseUrl: string; sqlFilePath?: string }): Promise<EstateSnapshot> {
  const { databaseUrl, sqlFilePath } = args;
  const sqlText = sqlFilePath ? fs.readFileSync(path.resolve(sqlFilePath), "utf8") : DEFAULT_SQL;
  const sql = postgres(databaseUrl, {
    max: 1
    // ssl: rely on URL options like ?sslmode=require to support managed PG defaults
  });
  try {
    const rows = (await sql.unsafe(sqlText)) as SyncRow[];
    return mapRowsToStats(rows);
  } finally {
    await sql.end({ timeout: 0 });
  }
}

