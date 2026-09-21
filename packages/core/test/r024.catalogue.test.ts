import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R024 — Index density on large tables", () => {
  const tinyEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8")
  );
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const policyBase = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red" as const };

  it("passes on not-large table regardless of existing indexes", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: Array.from({ length: 20 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R024");
    expect(r).toBeUndefined();
  });

  it("passes on large table under cap", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 7 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: i === 1, // include a unique
        primary: i === 0, // include a primary
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("fails red on large table at cap (counts unique/PK and live/valid/ready only)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        // 8 live+valid+ready indexes
        ...Array.from({ length: 6 }).map((_, i) => ({
          schema: "public",
          table: "sessions",
          name: `idx_${i}`,
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        })),
        {
          schema: "public",
          table: "sessions",
          name: "sessions_pkey",
          unique: true,
          primary: true,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["id"],
          replica_identity: true
        },
        {
          schema: "public",
          table: "sessions",
          name: "idx_unique",
          unique: true,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["archived_at"]
        },
        // and a couple of non-counted ones to prove filters: invalid/not-ready/live=false
        {
          schema: "public",
          table: "sessions",
          name: "idx_invalid",
          unique: false,
          primary: false,
          valid: false,
          ready: true,
          live: true,
          immediate: false,
          columns: ["c"]
        },
        {
          schema: "public",
          table: "sessions",
          name: "idx_not_ready",
          unique: false,
          primary: false,
          valid: true,
          ready: false,
          live: true,
          immediate: false,
          columns: ["c2"]
        },
        {
          schema: "public",
          table: "sessions",
          name: "idx_not_live",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: false,
          immediate: false,
          columns: ["c3"]
        }
      ]
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R024");
    expect(r?.severity).toBe("red");
    expect(r?.message).toContain("already has 8 indexes");
  });

  it("fails for CONCURRENTLY too (counts density the same)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX CONCURRENTLY idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")?.severity).toBe("red");
  });

  it("neutralizes when indexes section omitted", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).indexes;
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("treats empty indexes [] as zero count", () => {
    const estate: EstateSnapshot = { ...bigEstate, indexes: [] };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("excludes the index being created when name matches", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: i === 7 ? "idx_new" : `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    // one is excluded → effective count 7 → pass
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("respects knob override for max_indexes_large", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 9 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 10 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("treats relation_bytes >= 64MiB as large when n_live_tup is absent/0", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        {
          schema: "public",
          name: "sessions",
          n_live_tup: 0, // absent/0 → fallback to bytes
          relation_bytes: 67_108_864
        }
      ],
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")?.severity).toBe("red");
  });

  // Additional coverage
  it("CREATE UNIQUE INDEX at cap → red", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: i % 2 === 0,
        primary: i === 7 ? true : false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE UNIQUE INDEX idx_new_unique ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")?.severity).toBe("red");
  });

  it("no estate (empty snapshot) → neutralize", () => {
    const estate: EstateSnapshot = { tables: [] }; // no indexes section either
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("table absent from estate.tables → neutralize for that CREATE", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      // keep big table stats for sessions; create index on a different table not present
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.missing(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("indexes on other tables only, target large table has 0 → pass", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      // make indexes only on another table
      indexes: Array.from({ length: 12 }).map((_, i) => ({
        schema: "public",
        table: "other_table",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["c"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const policy = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("large_rows boundary: == threshold and at cap → fail; threshold-1 → pass", () => {
    // == threshold
    const estateAt: EstateSnapshot = {
      ...bigEstate,
      tables: [{ schema: "public", name: "sessions", n_live_tup: 100000 }],
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v1 = check({ sql, estate: estateAt, policy: pol });
    expect(v1.violations.find((x) => x.rule_id === "R024")?.severity).toBe("red");
    // threshold - 1 → pass
    const estateBelow: EstateSnapshot = {
      ...estateAt,
      tables: [{ schema: "public", name: "sessions", n_live_tup: 99999 }]
    };
    const v2 = check({ sql, estate: estateBelow, policy: pol });
    expect(v2.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("relation_bytes just under 64MiB with n_live_tup=0 + many indexes → pass", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [{ schema: "public", name: "sessions", n_live_tup: 0, relation_bytes: 64 * 1024 * 1024 - 1 }],
      indexes: Array.from({ length: 12 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, large_relation_bytes: 64 * 1024 * 1024, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("severity knob to yellow when configured", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8, severity: "yellow" } } as any };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R024")?.severity).toBe("yellow");
  });

  it("enabled: false disables R024 even when would fail", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 12 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { enabled: false, large_rows: 100000, max_indexes_large: 8 } } as any };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("schema match: CREATE INDEX on other.sessions must not count public.sessions indexes", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [
        { schema: "public", name: "sessions", n_live_tup: 1040000000 },
        { schema: "other", name: "sessions", n_live_tup: 1040000000 }
      ],
      indexes: Array.from({ length: 12 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON other.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });

  it("CREATE INDEX IF NOT EXISTS at cap → red", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX IF NOT EXISTS idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy: pol });
    const r = v.violations.find((x) => x.rule_id === "R024");
    expect(r?.severity).toBe("red");
    expect(r?.message).toContain("already has 8 indexes");
  });

  it("message includes table, index count, and guidance", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: Array.from({ length: 8 }).map((_, i) => ({
        schema: "public",
        table: "sessions",
        name: `idx_${i}`,
        unique: false,
        primary: false,
        valid: true,
        ready: true,
        live: true,
        immediate: true,
        columns: ["archived_at"]
      }))
    };
    const sql = `CREATE INDEX idx_new ON public.sessions(archived_at);`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy: pol });
    const msg = v.violations.find((x) => x.rule_id === "R024")?.message || "";
    expect(msg).toContain("public.sessions");
    expect(msg).toMatch(/already has 8 indexes/);
    expect(msg).toContain("max_indexes_large");
    expect(msg).toContain("drop an unused index");
  });

  it("only CREATE INDEX path — unrelated DDL must not emit R024", () => {
    const estate: EstateSnapshot = { ...bigEstate, indexes: Array.from({ length: 20 }).map((_, i) => ({
      schema: "public",
      table: "sessions",
      name: `idx_${i}`,
      unique: false,
      primary: false,
      valid: true,
      ready: true,
      live: true,
      immediate: true,
      columns: ["archived_at"]
    })) };
    const sql = `ALTER TABLE public.sessions ADD COLUMN x int;`;
    const pol = { ...policyBase, rules: { R024: { large_rows: 100000, max_indexes_large: 8 } } };
    const v = check({ sql, estate, policy: pol });
    expect(v.violations.find((x) => x.rule_id === "R024")).toBeUndefined();
  });
});

