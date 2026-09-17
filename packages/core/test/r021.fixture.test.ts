import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R021 — CIC without explicit index name", () => {
  it("yellows advisory", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/cic_without_name.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R021: { severity: "yellow" } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R021");
    expect(r?.severity).toBe("yellow");
  });
});

