import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R005 — SET NOT NULL without validated CHECK", () => {
  it("fails RED on large table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/set_not_null.sql"), "utf8");
    const stats = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/stats_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const verdict = check({ sql, stats, policy });
    const r005 = verdict.violations.find((v) => v.rule_id === "R005");
    expect(r005?.severity).toBe("red");
    expect(verdict.verdict).toBe("fail");
  });
});

