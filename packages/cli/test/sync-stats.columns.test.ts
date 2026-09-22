import { describe, it, expect, vi } from "vitest";
import {
  mapRowsToStats,
  type SyncTableRow,
  type SyncColumnRow,
  type SyncConstraintRow,
  type SyncIndexRow
} from "../src/syncStats";

// Stub 'postgres' so the module loads without the dependency for mapRowsToStats tests
vi.mock("postgres", () => {
  return {
    default: () => ({
      unsafe: async () => [],
      end: async () => {}
    })
  };
});

describe("CLI syncStats — index columns omit-vs-empty semantics", () => {
  const tables: SyncTableRow[] = [
    {
      pg_version: "16.4",
      schema: "public",
      name: "t",
      relid: 1,
      relkind: "r",
      replica_identity: "d",
      n_live_tup: 1,
      n_dead_tup: 0,
      n_tup_ins: 0,
      n_tup_upd: 0,
      n_tup_del: 0,
      seq_scan: 0,
      idx_scan: 0,
      last_analyze: null,
      last_autoanalyze: null,
      relation_bytes: 0,
      total_bytes: 0
    }
  ];
  const columns: SyncColumnRow[] = [];
  const constraints: SyncConstraintRow[] = [];

  it("emits columns[] for attribute-based and omits for expression-only", () => {
    const indexes: SyncIndexRow[] = [
      {
        schema: "public",
        table_name: "t",
        name: "idx_ab",
        is_unique: false,
        is_primary: false,
        valid: true,
        ready: true,
        live: true,
        is_immediate: true,
        replica_identity: false,
        columns: ["a", "b"]
      },
      {
        schema: "public",
        table_name: "t",
        name: "idx_expr",
        is_unique: false,
        is_primary: false,
        valid: true,
        ready: true,
        live: true,
        is_immediate: true,
        replica_identity: false,
        columns: null as unknown as string[]
      }
    ];
    const estate = mapRowsToStats({ tables, columns, constraints, indexes });
    const i1 = estate.indexes?.find((i) => i.name === "idx_ab");
    const i2 = estate.indexes?.find((i) => i.name === "idx_expr");
    expect(i1?.columns).toEqual(["a", "b"]);
    expect(Object.prototype.hasOwnProperty.call(i2 || {}, "columns")).toBe(false);
  });
});

