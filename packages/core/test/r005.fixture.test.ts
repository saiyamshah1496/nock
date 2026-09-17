import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R005 — SET NOT NULL without validated CHECK", () => {
  it("fails RED on large table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/set_not_null.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const verdict = check({ sql, estate, policy });
    const r005 = verdict.violations.find((v) => v.rule_id === "R005");
    expect(r005?.severity).toBe("red");
    expect(verdict.verdict).toBe("fail");
  });
  it("passes on tiny estate", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/set_not_null.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const verdict = check({ sql, estate, policy });
    const r005 = verdict.violations.find((v) => v.rule_id === "R005");
    expect(r005).toBeUndefined();
    expect(verdict.verdict).not.toBe("fail");
  });
  it("suppresses R005 with expand/contract pattern in same batch", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/expand_contract_set_not_null.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const verdict = check({ sql, estate, policy });
    // No R005 red
    expect(verdict.violations.find((v) => v.rule_id === "R005")).toBeUndefined();
  });
  it("R010 applies to SET NOT NULL on hot table, cleared by preceding lock_timeout", () => {
    const hotEstate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const sql1 = readFileSync(join(__dirname, "../../../fixtures/set_not_null.sql"), "utf8");
    const v1 = check({ sql: sql1, estate: hotEstate, policy });
    expect(v1.violations.map((v) => v.rule_id)).toContain("R010");

    const sql2 = readFileSync(join(__dirname, "../../../fixtures/set_not_null_with_lock_timeout.sql"), "utf8");
    const v2 = check({ sql: sql2, estate: hotEstate, policy });
    expect(v2.violations.map((v) => v.rule_id)).not.toContain("R010");
  });
});

