import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

const basePolicy = {
  id: "nock.postgres.ddl.default",
  version: "1.0.0",
  fail_on: "red",
  rules: {
    R007: { red_rows: 100000 },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R007 — ADD FOREIGN KEY without NOT VALID", () => {
  it("fails RED on hot child estate", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy: basePolicy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R007");
    const r007 = verdict.violations.find((v) => v.rule_id === "R007");
    expect(r007?.severity).toBe("red");
    expect(verdict.verdict).toBe("fail");
  });

  it("does not fire on tiny estate (size-gated)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy: basePolicy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R007");
  });

  it("does not fire when NOT VALID is used", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk_not_valid.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy: basePolicy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R007");
  });

  it("optional: ADD CONSTRAINT name FOREIGN KEY without NOT VALID → fires", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk_add_constraint.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy: basePolicy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R007");
  });
});

