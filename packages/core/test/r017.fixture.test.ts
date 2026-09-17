import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R017 — ADD UNIQUE/PRIMARY KEY without USING INDEX", () => {
  it("reds on large table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_unique_pk.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R017: { red_rows: 10000 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r?.severity).toBe("red");
  });

  it("yellows on tiny table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_unique_pk.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R017: { red_rows: 10000 } } };
    const v = check({ sql, estate, policy });
    const y = v.violations.find((x) => x.rule_id === "R017");
    expect(y?.severity).toBe("yellow");
  });

  it("R010 applies to PK/UNIQUE add on hot table, cleared by preceding lock_timeout", () => {
    const hot = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const sql1 = readFileSync(join(__dirname, "../../../fixtures/add_unique_pk.sql"), "utf8");
    const v1 = check({ sql: sql1, estate: hot, policy });
    expect(v1.violations.map((v) => v.rule_id)).toContain("R010");

    const sql2 = readFileSync(join(__dirname, "../../../fixtures/add_unique_pk_with_lock_timeout.sql"), "utf8");
    const v2 = check({ sql: sql2, estate: hot, policy });
    expect(v2.violations.map((v) => v.rule_id)).not.toContain("R010");
  });
});

