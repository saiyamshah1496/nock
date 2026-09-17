import { describe, it, expect } from "vitest";
import { check, type EstateSnapshot, type PolicyResolved } from "../src";
import YAML from "yaml";
import { readFileSync } from "fs";
import { join } from "path";

describe("no-stats behavior neutralizes size-gated reds", () => {
  const policy: PolicyResolved = YAML.parse(
    readFileSync(join(__dirname, "../../../policy.default.yml"), "utf8")
  ) as PolicyResolved;
  const estate: EstateSnapshot = {
    captured_at: new Date().toISOString(),
    tables: [{ schema: "public", name: "t", n_live_tup: 1_000_000 }],
  };
  const sql = `CREATE INDEX idx_t_a ON public.t(a);`; // non-concurrent

  it("emits reds under normal mode", () => {
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.severity === "red")).toBe(true);
  });

  it("downgrades size-gated reds to yellow under no-stats warn", () => {
    const v = check({ sql, estate, policy, noStatsBehavior: "warn" });
    expect(v.violations.some((x) => x.severity === "red")).toBe(false);
    expect(v.violations.some((x) => x.severity === "yellow")).toBe(true);
    expect(v.meta.size_gates_neutralized).toBe(true);
  });
});

