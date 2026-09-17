import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

const policy = {
  id: "nock.postgres.ddl.default",
  version: "1.0.0",
  fail_on: "red",
  rules: {
    R001: { red_rows: 10000 },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R010 — generic hot DDL without lock_timeout", () => {
  it("co-fires with R001 on non-concurrent CREATE INDEX on hot table", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R001");
    expect(ids).toContain("R010");
  });
  it("is cleared by preceding SET lock_timeout", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/create_index_with_lock_timeout.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R001");
    expect(ids).not.toContain("R010");
  });
});

