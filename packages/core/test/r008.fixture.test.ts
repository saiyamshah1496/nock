import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R008 — ALTER COLUMN TYPE rewrite/unknown coercibility", () => {
  it("reds when USING present on large table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_using.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const r = verdict.violations.find((v) => v.rule_id === "R008");
    expect(r?.severity).toBe("red");
  });

  it("does not warn for likely widen to text (no USING)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_widen.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    expect(verdict.violations.some((v) => v.rule_id === "R008")).toBe(false);
  });

  it("does not warn for likely varchar length widen (no USING)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_varchar_widen.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    expect(verdict.violations.some((v) => v.rule_id === "R008")).toBe(false);
  });

  it("reds on clear rewrite to integer on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_text_to_int.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const r = verdict.violations.find((v) => v.rule_id === "R008");
    expect(r?.severity).toBe("red");
  });

  it("reds on JSONB conversion on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_to_jsonb.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const r = verdict.violations.find((v) => v.rule_id === "R008");
    expect(r?.severity).toBe("red");
  });

  it("reds on numeric precision change on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_numeric_precision.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R008: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const r = verdict.violations.find((v) => v.rule_id === "R008");
    expect(r?.severity).toBe("red");
  });
});

