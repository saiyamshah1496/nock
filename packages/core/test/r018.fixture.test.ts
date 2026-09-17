import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R018 — ADD EXCLUDE constraint size-gated", () => {
  it("reds on large table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_exclude.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R018: { red_rows: 100000, yellow_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R018");
    expect(r?.severity).toBe("red");
  });
});

