import { describe, it, expect } from "vitest";
import {
  mapRowsToStats,
  type SyncTableRow,
  type SyncColumnRow,
  type SyncConstraintRow,
  type SyncIndexRow,
  runSyncStats
} from "../src/syncStats";

describe("mapRowsToStats", () => {
  it("maps query rows into estate.json shape", () => {
    const tables: SyncTableRow[] = [
      {
        pg_version: "16.4",
        schema: "public",
        name: "sessions",
        relid: 12345,
        relkind: "r",
        replica_identity: "d",
        n_live_tup: 1040000000,
        n_dead_tup: 1200000,
        n_tup_ins: 50000,
        n_tup_upd: 120000,
        n_tup_del: 8000,
        seq_scan: 42,
        idx_scan: 990000,
        last_analyze: "2026-09-15T12:00:00Z",
        last_autoanalyze: null,
        relation_bytes: 890000000000,
        total_bytes: 1120000000000
      }
    ];
    const columns: SyncColumnRow[] = [
      {
        schema: "public",
        table_name: "sessions",
        column_name: "id",
        not_null: true,
        type_name: "uuid",
        has_default: true
      }
    ];
    const constraints: SyncConstraintRow[] = [
      {
        schema: "public",
        table_name: "sessions",
        name: "sessions_pkey",
        kind: "pk",
        validated: true,
        columns: ["id"],
        foreign_table: null,
        foreign_columns: null,
        supporting_index: "sessions_pkey"
      }
    ];
    const indexes: SyncIndexRow[] = [
      {
        schema: "public",
        table_name: "sessions",
        name: "idx_sessions_user_id",
        is_unique: false,
        is_primary: false,
        valid: true,
        ready: true,
        live: true,
        is_immediate: true,
        replica_identity: false,
        columns: ["user_id"]
      }
    ];
    const snap = mapRowsToStats({ tables, columns, constraints, indexes });
    expect(snap.schema_version).toBe("1");
    expect(snap.pg_version).toBe("16.4");
    expect(snap.source).toBe("sync-estate");
    expect(snap.captured_at).toBeTruthy();
    expect(snap.tables.length).toBe(1);
    expect(snap.tables[0]).toEqual(
      expect.objectContaining({
        schema: "public",
        name: "sessions",
        n_live_tup: 1040000000,
        n_dead_tup: 1200000,
        n_tup_ins: 50000,
        n_tup_upd: 120000,
        n_tup_del: 8000,
        relation_bytes: 890000000000,
        total_bytes: 1120000000000,
        relkind: "r",
        replica_identity: "d",
        last_analyze: "2026-09-15T12:00:00Z",
        last_autoanalyze: null
      })
    );
    expect(Array.isArray(snap.columns)).toBe(true);
    expect(Array.isArray(snap.constraints)).toBe(true);
    expect(Array.isArray(snap.indexes)).toBe(true);
    expect(snap.columns?.[0]).toEqual(
      expect.objectContaining({
        schema: "public",
        table: "sessions",
        column: "id",
        not_null: true,
        type_name: "uuid",
        has_default: true
      })
    );
    expect(snap.constraints?.[0]).toEqual(
      expect.objectContaining({
        schema: "public",
        table: "sessions",
        name: "sessions_pkey",
        kind: "pk",
        validated: true,
        columns: ["id"],
        supporting_index: "sessions_pkey"
      })
    );
    expect(snap.indexes?.[0]).toEqual(
      expect.objectContaining({
        schema: "public",
        table: "sessions",
        name: "idx_sessions_user_id",
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["user_id"],
        replica_identity: false
      })
    );
  });
});

describe("integration (optional)", () => {
  const dsn = process.env.NOCK_TEST_DATABASE_URL;
  (dsn ? it : it.skip)("runs real query when NOCK_TEST_DATABASE_URL is set", async () => {
    const snap = await runSyncStats({ databaseUrl: dsn! });
    expect(snap.pg_version).toBeTruthy();
    expect(Array.isArray(snap.tables)).toBe(true);
    // Catalogue sections should be present (may be empty arrays on minimal DBs)
    expect(Object.prototype.hasOwnProperty.call(snap, "columns")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snap, "constraints")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(snap, "indexes")).toBe(true);
  });
});

