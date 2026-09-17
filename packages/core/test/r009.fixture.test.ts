import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R009 — DROP/RENAME advisories", () => {
  it("emits yellow advisories", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/drop_and_rename.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R009: { severity: "yellow" } } };
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.filter((v) => v.rule_id === "R009");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((v) => v.severity === "yellow")).toBe(true);
  });
});

