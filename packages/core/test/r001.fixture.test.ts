import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R001 non-concurrent CREATE INDEX on large table", () => {
  it("fails RED on Railway-shaped billion-row fixture", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/railway_oct.sql"), "utf8");
    const stats = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/stats_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: {
        R001: { red_rows: 10000 },
        R010: { always_require_lock_timeout_above_rows: 1000000 }
      }
    };
    const verdict = check({ sql, stats, policy });
    const r001 = verdict.violations.find((v) => v.rule_id === "R001");
    expect(verdict.verdict).toBe("fail");
    expect(r001?.severity).toBe("red");
  });
});

