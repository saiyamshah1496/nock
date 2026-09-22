import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R025 — Write-heavy index maintenance on large tables", () => {
  const tinyEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8")
  );
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const policyBase = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red" as const };

  it("neutralizes when write counters are missing for the target table", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // ensure target table present, but without write counters (fixture lacks them by default)
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R025: { yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R025")).toBeUndefined();
  });

  it("fails red on large table when write sum >= red_writes", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 1_040_000_000,
          n_tup_ins: 600_000,
          n_tup_upd: 650_000,
          n_tup_del: 50_000,
        },
      ],
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R025: { yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } };
    const v = check({ sql, estate, policy: pol });
    const r = v.violations.find((x) => x.rule_id === "R025");
    expect(r?.severity).toBe("red");
    expect(r?.message).toContain("write-heavy");
  });

  it("fires on CONCURRENTLY too (same thresholds)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 1_040_000_000,
          n_tup_ins: 800_000,
          n_tup_upd: 300_000,
          n_tup_del: 50_000,
        },
      ],
    };
    const sql = `CREATE INDEX CONCURRENTLY idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R025: { yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R025")?.severity).toBe("red");
  });

  it("small table with high writes → yellow advisory (co-gated red only when large)", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 10_000, // small
          n_tup_ins: 200_000,
          n_tup_upd: 50_000,
          n_tup_del: 10_000,
        },
      ],
    };
    const sql = `CREATE INDEX IF NOT EXISTS idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R025: { yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } };
    const v = check({ sql, estate, policy: pol });
    const r = v.violations.find((x) => x.rule_id === "R025");
    expect(r?.severity).toBe("yellow");
  });

  it("enabled: false disables R025 even when would fail", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 1_040_000_000,
          n_tup_ins: 2_000_000,
          n_tup_upd: 2_000_000,
          n_tup_del: 100_000,
        },
      ],
    };
    const sql = `CREATE UNIQUE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R025: { enabled: false, yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } as any };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R025")).toBeUndefined();
  });

  it("unrelated DDL must not emit R025", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 1_040_000_000,
          n_tup_ins: 2_000_000,
          n_tup_upd: 2_000_000,
          n_tup_del: 100_000,
        },
      ],
    };
    const sql = `ALTER TABLE public.sessions ADD COLUMN x int;`;
    const pol = { ...policyBase, rules: { R025: { yellow_writes: 100000, red_writes: 1000000, large_rows: 100000 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R025")).toBeUndefined();
  });
});

