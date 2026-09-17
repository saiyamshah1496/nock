import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R007 — ADD FOREIGN KEY without NOT VALID", () => {
  it("fails RED on large child table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk_without_not_valid.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R007: { red_rows: 100000 } }
    };
    const verdict = check({ sql, estate, policy });
    const r = verdict.violations.find((v) => v.rule_id === "R007");
    expect(r?.severity).toBe("red");
  });

  it("passes on tiny child table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk_without_not_valid.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R007: { red_rows: 100000 } } };
    const verdict = check({ sql, estate, policy });
    expect(verdict.violations.some((v) => v.rule_id === "R007")).toBe(false);
  });
});

