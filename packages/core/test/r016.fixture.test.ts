import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R016 — Multiple ACCESS EXCLUSIVE in one batch on hot table without lock_timeout", () => {
  it("yellows when two AE ops on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/multiple_ae.sql"), "utf8");
    const big = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const v = check({ sql, estate: big, policy });
    const hit = v.violations.find((x) => x.rule_id === "R016");
    expect(hit?.severity).toBe("yellow");
  });
});

