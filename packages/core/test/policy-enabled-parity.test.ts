import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import YAML from "yaml";
import { check, type EstateSnapshot, type PolicyResolved } from "../src";

function readFixture(rel: string): string {
  return fs.readFileSync(path.resolve(__dirname, "../../../", rel), "utf8");
}

function loadEstate(name: "estate_tiny.json" | "estate_billion.json"): EstateSnapshot {
  const raw = readFixture(`fixtures/${name}`);
  return JSON.parse(raw) as EstateSnapshot;
}

function loadDefaultPolicy(): PolicyResolved {
  const raw = readFixture("policy.default.yml");
  const p = YAML.parse(raw) as PolicyResolved;
  return p;
}

describe("Policy enabled flag and hosted parity", () => {
  it("omit enabled → rule still evaluates", () => {
    const policy = loadDefaultPolicy(); // no enabled flags
    const estate = loadEstate("estate_billion.json");
    const sql = readFixture("fixtures/create_index_nonconcurrent.sql");
    const verdict = check({ sql, estate, policy });
    // R001 should appear (estate is very large)
    const hasR001 = verdict.violations.some((v) => v.rule_id === "R001");
    expect(hasR001).toBe(true);
  });

  it("enabled: false skips a rule entirely", () => {
    const policy = loadDefaultPolicy();
    // Disable R001 explicitly
    policy.rules = { ...policy.rules, R001: { ...(policy.rules?.R001 || {}), enabled: false } };
    const estate = loadEstate("estate_billion.json");
    const sql = readFixture("fixtures/create_index_nonconcurrent.sql");
    const verdict = check({ sql, estate, policy });
    // No R001 violation when disabled
    const hasR001 = verdict.violations.some((v) => v.rule_id === "R001");
    expect(hasR001).toBe(false);
  });

  it("hosted-shaped policy resolves identically to file policy for same knobs", () => {
    const filePolicy = loadDefaultPolicy();
    const hostedPolicy: PolicyResolved = JSON.parse(JSON.stringify(filePolicy));
    const estate = loadEstate("estate_tiny.json");
    const sql = readFixture("fixtures/refresh_mv_plain.sql");
    const v1 = check({ sql, estate, policy: filePolicy });
    const v2 = check({ sql, estate, policy: hostedPolicy });
    expect(v1.verdict).toBe(v2.verdict);
    // Compare violation ids and severities ignoring order
    const sig = (v: { rule_id: string; severity: string }) => `${v.rule_id}:${v.severity}`;
    const s1 = v1.violations.map(sig).sort().join(",");
    const s2 = v2.violations.map(sig).sort().join(",");
    expect(s1).toBe(s2);
  });

  it("thresholds and fail_on respected when enabled", () => {
    const policy = loadDefaultPolicy();
    // Set R001 threshold very high to avoid firing, leave rule enabled
    policy.rules = { ...policy.rules, R001: { ...(policy.rules?.R001 || {}), red_rows: 10_000_000_000 } };
    // Also disable R010 to avoid generic hot-table lock_timeout noise in this assertion
    policy.rules = { ...policy.rules, R010: { ...(policy.rules?.R010 || {}), enabled: false } };
    // Keep fail_on at default "red" so yellows (if any) don't fail
    const estate = loadEstate("estate_billion.json");
    const sql = readFixture("fixtures/create_index_nonconcurrent.sql");
    const verdict = check({ sql, estate, policy });
    const hasR001 = verdict.violations.some((v) => v.rule_id === "R001");
    expect(hasR001).toBe(false);
    expect(verdict.verdict).toBe("pass");
  });
});

