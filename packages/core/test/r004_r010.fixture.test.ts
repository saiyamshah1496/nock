import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

const policy = {
  id: "nock.postgres.ddl.default",
  version: "1.0.0",
  fail_on: "red",
  rules: {
    R004: { hot_rows: 1000000, require_lock_timeout: true },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R004/R010 — ADD COLUMN hot table without lock_timeout", () => {
  it("fails on Dec-shaped ADD COLUMN", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/dec_add_column.sql"), "utf8");
    const stats = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/stats_billion.json"), "utf8"));
    const verdict = check({ sql, stats, policy });
    expect(verdict.verdict).toBe("fail");
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R004");
  });
});

