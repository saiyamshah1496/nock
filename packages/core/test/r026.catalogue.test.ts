import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R026 — Redundant / overlapping index", () => {
  const tinyEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8")
  );
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const policyBase = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red" as const };

  it("exact duplicate on large table → red (size-gated)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_dup ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    const r = v.violations.find((x) => x.rule_id === "R026");
    expect(r?.severity).toBe("red");
    expect(r?.message).toContain("duplicate");
  });

  it("exact duplicate on small table → yellow", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_dup ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")?.severity).toBe("yellow");
  });

  it("left-prefix redundant (btree): new (a) when (a,b) exists → hit", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_a_b",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at", "user_id"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_a ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    const r = v.violations.find((x) => x.rule_id === "R026");
    expect(r).toBeDefined();
    expect(r?.message).toContain("left-prefix");
  });

  it("does NOT hit when a matching index exists but is not live", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: false,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_dup ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeUndefined();
  });

  it("longer key when shorter exists is NOT redundant", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_a",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_a_b ON public.sessions(archived_at, user_id);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeUndefined();
  });

  it("uniqueness matrix: existing unique covers new non-unique; existing non-unique does NOT cover new unique", () => {
    // existing unique (a,b) covers new non-unique (a)
    const estate1: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_unique_ab",
          unique: true,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at", "user_id"]
        }
      ]
    };
    const sql1 = `CREATE INDEX idx_a ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v1 = check({ sql: sql1, estate: estate1, policy: pol });
    expect(v1.violations.find((x) => x.rule_id === "R026")).toBeDefined();

    // existing non-unique (a) does NOT cover new unique (a)
    const estate2: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_a",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql2 = `CREATE UNIQUE INDEX idx_a_u ON public.sessions(archived_at);`;
    const v2 = check({ sql: sql2, estate: estate2, policy: pol });
    expect(v2.violations.find((x) => x.rule_id === "R026")).toBeUndefined();
  });

  it("still hits when some existing indexes omit columns but a comparable one has columns[]", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_expr",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true
          // columns omitted intentionally to simulate expression-only
        } as any
        ,
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_a ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeDefined();
  });

  it("parses CONCURRENTLY forms as well", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX CONCURRENTLY idx_dup ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeDefined();
  });

  it("severity knob: downgrade to yellow even when large", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_archived_at",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_dup ON public.sessions(archived_at);`;
    const pol = {
      ...policyBase,
      rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024, severity: "yellow" } } as any
    };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")?.severity).toBe("yellow");
  });

  it("does not flag when proposed columns are expressions (unresolvable)", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: []
    };
    const sql = `CREATE INDEX idx_expr ON public.sessions ((lower(archived_at)));`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeUndefined();
  });

  it("neutralizes when only expression-only indexes exist on the table (no comparable columns[])", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_expr_only",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true
          // columns omitted intentionally
        } as any
      ]
    };
    const sql = `CREATE INDEX idx_a ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R026: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R026")).toBeUndefined();
  });
});

