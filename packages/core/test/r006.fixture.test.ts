import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R006 — ADD CHECK without NOT VALID on large table", () => {
  it("fails RED", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/datapace_check.sql"), "utf8");
    const stats = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/stats_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R006: { red_rows: 50000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const verdict = check({ sql, stats, policy });
    const r006 = verdict.violations.find((v) => v.rule_id === "R006");
    expect(r006?.severity).toBe("red");
    expect(verdict.verdict).toBe("fail");
  });
});

