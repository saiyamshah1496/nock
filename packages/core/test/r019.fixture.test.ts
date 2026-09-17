import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R019 — TRUNCATE on estate table", () => {
  it("reds always", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/truncate.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R019: { severity: "red" } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R019");
    expect(r?.severity).toBe("red");
  });
});

