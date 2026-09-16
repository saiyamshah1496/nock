import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R012 — VACUUM FULL", () => {
  it("fails RED always", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/vacuum_full.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: {} };
    const verdict = check({ sql, estate, policy });
    const r012 = verdict.violations.find((v) => v.rule_id === "R012");
    expect(r012?.severity).toBe("red");
    expect(verdict.verdict).toBe("fail");
  });
});

