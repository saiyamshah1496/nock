import { describe, it, expect, vi } from "vitest";
import {
  mapRowsToStats,
  type SyncTableRow,
  type SyncColumnRow,
  type SyncConstraintRow,
  type SyncIndexRow,
} from "../src/syncStats";

// Stub 'postgres' for module-load in unit tests that only exercise mappers
vi.mock("postgres", () => {
  return {
    default: () => ({
      unsafe: async () => [],
      end: async () => {}
    })
  };
});

describe("governance catalogue mapper", () => {
  it("maps full shapes for tables/columns/constraints/indexes", () => {
    const tables: SyncTableRow[] = [
      {
        pg_version: "16.4",
        schema: "public",
        name: "orders",
        relid: 42,
        relkind: "r",
        replica_identity: "d",
        n_live_tup: 12345,
        n_dead_tup: 10,
        n_tup_ins: 0,
        n_tup_upd: 0,
        n_tup_del: 0,
        seq_scan: 0,
        idx_scan: 0,
        last_analyze: "2026-09-15T12:00:00Z",
        last_autoanalyze: null,
        relation_bytes: 1000,
        total_bytes: 2000
      }
    ];
    const columns: SyncColumnRow[] = [
      { schema: "public", table_name: "orders", column_name: "email", not_null: false, type_name: "text", has_default: false },
      { schema: "public", table_name: "orders", column_name: "country", not_null: true, type_name: "text", has_default: true }
    ];
    const constraints: SyncConstraintRow[] = [
      {
        schema: "public",
        table_name: "orders",
        name: "orders_email_nn",
        kind: "check",
        validated: true,
        columns: ["email"],
        foreign_table: null,
        foreign_columns: null,
        supporting_index: null
      },
      {
        schema: "public",
        table_name: "orders",
        name: "orders_customer_fk",
        kind: "fk",
        validated: false,
        columns: ["customer_id"],
        foreign_table: "public.customers",
        foreign_columns: ["id"],
        supporting_index: null
      }
    ];
    const indexes: SyncIndexRow[] = [
      {
        schema: "public",
        table_name: "orders",
        name: "idx_orders_email_unique",
        is_unique: true,
        is_primary: false,
        valid: true,
        ready: true,
        live: true,
        is_immediate: true,
        replica_identity: false,
        columns: ["email"]
      },
      {
        schema: "public",
        table_name: "orders",
        name: "idx_orders_lower_email",
        is_unique: false,
        is_primary: false,
        valid: true,
        ready: true,
        live: true,
        is_immediate: true,
        replica_identity: false,
        // Expression index: mapper should accept null and omit columns field
        columns: null as any
      }
    ];

    const snap = mapRowsToStats({ tables, columns, constraints, indexes });
    // tables
    expect(snap.tables[0]).toEqual(
      expect.objectContaining({
        schema: "public",
        name: "orders",
        n_live_tup: 12345,
        relkind: "r",
        replica_identity: "d"
      })
    );
    // columns
    expect(snap.columns?.find(c => c.column === "email")).toEqual(
      expect.objectContaining({ not_null: false, type_name: "text", has_default: undefined })
    );
    expect(snap.columns?.find(c => c.column === "country")).toEqual(
      expect.objectContaining({ not_null: true, type_name: "text", has_default: true })
    );
    // constraints
    const fk = snap.constraints?.find(c => c.name === "orders_customer_fk");
    expect(fk).toEqual(
      expect.objectContaining({
        kind: "fk",
        validated: false,
        foreign_table: "public.customers",
        foreign_columns: ["id"]
      })
    );
    // indexes
    const u = snap.indexes?.find(i => i.name === "idx_orders_email_unique");
    expect(u).toEqual(
      expect.objectContaining({
        unique: true,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["email"],
        replica_identity: false
      })
    );
    // Expression index columns are omitted (unknown)
    const expr = snap.indexes?.find(i => i.name === "idx_orders_lower_email");
    expect(expr).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(expr || {}, "columns")).toBe(false);
  });

  it("never stores expression/default text in estate JSON", () => {
    const snap = mapRowsToStats({
      tables: [
        {
          pg_version: "16.4",
          schema: "public",
          name: "t",
          relid: 1,
          relkind: "r",
          replica_identity: "d",
          n_live_tup: 0,
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
      ],
      columns: [
        // Even if a default would exist in catalog, mapper only carries has_default flag
        { schema: "public", table_name: "t", column_name: "c", not_null: false, type_name: "text", has_default: true }
      ],
      constraints: [
        // CHECK expression text must not be present; only structure
        { schema: "public", table_name: "t", name: "t_c_nn", kind: "check", validated: true, columns: ["c"], foreign_table: null, foreign_columns: null, supporting_index: null }
      ],
      indexes: [
        // Partial/expr info is not stored; ensure there is no unexpected text fields
        { schema: "public", table_name: "t", name: "idx_t_c", is_unique: false, is_primary: false, valid: false, ready: true, live: true, is_immediate: true, replica_identity: false, columns: ["c"] }
      ]
    });
    const json = JSON.stringify(snap);
    // Ensure no risky substrings or fields
    expect(json).not.toMatch(/pg_get_constraintdef/i);
    expect(json).not.toMatch(/CHECK\s*\(/i);
    expect(json).not.toMatch(/DEFAULT\s+/i);
    expect(json).not.toMatch(/indexprs|indpred/i);
  });
});

