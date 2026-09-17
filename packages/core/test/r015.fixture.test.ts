import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R015 — CIC without prior lock_timeout on hot table", () => {
  it("reds on hot table without lock_timeout, yellows on medium", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/cic_without_lock_timeout.sql"), "utf8");
    const big = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const tiny = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R010: { always_require_lock_timeout_above_rows: 1000000 }, R015: { yellow_rows: 50 } }
    };
    const v1 = check({ sql, estate: big, policy });
    const v2 = check({ sql, estate: tiny, policy });
    const r = v1.violations.find((x) => x.rule_id === "R015");
    expect(r?.severity).toBe("red");
    const y = v2.violations.find((x) => x.rule_id === "R015");
    expect(y?.severity).toBe("yellow");
  });
});

