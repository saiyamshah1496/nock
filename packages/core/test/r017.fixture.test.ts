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
});

