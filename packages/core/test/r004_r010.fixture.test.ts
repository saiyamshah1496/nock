import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

const policy = {
  id: "nock.postgres.ddl.default",
  version: "1.0.0",
  fail_on: "red",
  rules: {
    R004: { hot_rows: 1000000 },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R004/R010 — ADD COLUMN hot table without lock_timeout", () => {
  it("fails on Dec-shaped ADD COLUMN and co-fires R010", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/dec_add_column.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    expect(verdict.verdict).toBe("fail");
    const ids = verdict.violations.map((v) => v.rule_id);
    // Coalesced intent: both specific and generic ids present
    expect(ids).toContain("R004");
    expect(ids).toContain("R010");
  });
  it("does not flag R004 on tiny estate", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/dec_add_column.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R004");
  });
  it("clears with preceding SET lock_timeout", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_column_with_lock_timeout.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R004");
    expect(ids).not.toContain("R010");
    expect(verdict.verdict).toBe("pass");
  });
  it("clears with preceding SET LOCAL lock_timeout", () => {
    const sql = readFileSync(
      join(__dirname, "../../../fixtures/add_column_with_local_lock_timeout.sql"),
      "utf8"
    );
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R004");
    expect(ids).not.toContain("R010");
    expect(verdict.verdict).toBe("pass");
  });
  it("still flags on constant DEFAULT on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_column_default.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R004");
    expect(ids).toContain("R010");
  });
});

