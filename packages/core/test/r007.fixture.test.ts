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
    // Omit catalogue sections to exercise the pre-catalogue arm only
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).constraints;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).indexes;
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R007: { red_rows: 100000 } } };
    const verdict = check({ sql, estate, policy });
    expect(verdict.violations.some((v) => v.rule_id === "R007")).toBe(false);
  });

  it("R010 applies to FK add on hot table, cleared by preceding lock_timeout", () => {
    const hot = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R007: { red_rows: 100000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } }
    };
    const sql1 = readFileSync(join(__dirname, "../../../fixtures/add_fk_without_not_valid.sql"), "utf8");
    const v1 = check({ sql: sql1, estate: hot, policy });
    expect(v1.violations.map((v) => v.rule_id)).toContain("R010");

    const sql2 = readFileSync(join(__dirname, "../../../fixtures/add_fk_with_lock_timeout.sql"), "utf8");
    const v2 = check({ sql: sql2, estate: hot, policy });
    expect(v2.violations.map((v) => v.rule_id)).not.toContain("R010");
  });
});

