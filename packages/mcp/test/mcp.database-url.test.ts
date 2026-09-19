import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkBeforeApplyHostedOrLocal } from "../src/index.js";

// Mock 'postgres' to simulate DB catalog responses
vi.mock("postgres", () => {
  let call = 0;
  const rowsSeq: any[] = [
    // Tables
    [
      {
        pg_version: "16.4",
        schema: "public",
        name: "sessions",
        relid: 123,
        relkind: "r",
        replica_identity: "d",
        n_live_tup: 2_000_000,
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
    // Columns
    [
      {
        schema: "public",
        table_name: "sessions",
        column_name: "archived_at",
        not_null: false,
        type_name: "timestamp with time zone",
        has_default: false
      }
    ],
    // Constraints
    [],
    // Indexes
    []
  ];
  return {
    default: (conn: string) => {
      return {
        unsafe: async (_: string) => {
          const out = rowsSeq[call] ?? [];
          call++;
          return out;
        },
        end: async () => {}
      };
    }
  };
});

describe("MCP — databaseUrl live refresh path", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns RED with R001 and R010 for non-concurrent CREATE INDEX on hot table", async () => {
    const sql = "CREATE INDEX idx_sessions_archived_at ON public.sessions(archived_at);";
    const verdict = await checkBeforeApplyHostedOrLocal({
      sql,
      databaseUrl: "postgres://user:pass@host/db"
    });
    const ruleIds = verdict.violations.map((v) => v.rule_id).sort();
    expect(verdict.verdict).toBe("fail");
    expect(ruleIds).toContain("R001");
    expect(ruleIds).toContain("R010");
  });
});

