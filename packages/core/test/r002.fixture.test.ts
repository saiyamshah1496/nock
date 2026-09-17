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
    R004: { hot_rows: 1000000 },
    R006: { red_rows: 50000 },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R002 — concurrent DDL inside explicit transaction", () => {
  it("flags CREATE INDEX CONCURRENTLY inside BEGIN…COMMIT as RED", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/txn_create_index_concurrently.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R002");
    const r002 = verdict.violations.find((v) => v.rule_id === "R002");
    expect(r002?.severity).toBe("red");
  });

  it("does not flag R002 when CONCURRENTLY has no surrounding transaction", () => {
    const sql = `CREATE INDEX CONCURRENTLY idx_sessions_archived_at ON sessions (archived_at);`;
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R002");
  });

  it("flags CREATE UNIQUE INDEX CONCURRENTLY inside BEGIN…COMMIT as RED", () => {
    const sql = readFileSync(
      join(__dirname, "../../../fixtures/txn_create_unique_index_concurrently.sql"),
      "utf8"
    );
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R002");
    const r002 = verdict.violations.find((v) => v.rule_id === "R002");
    expect(r002?.severity).toBe("red");
  });

  it("does not flag R002 on non-concurrent CREATE INDEX inside BEGIN…COMMIT", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/txn_create_index_nonconcurrent.sql"), "utf8");
    // Use tiny estate to avoid R001 firing; R002 should not fire at all
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R002");
  });

  it("estate size does not affect R002 outcome (always red when inside explicit txn)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/txn_create_index_concurrently.sql"), "utf8");
    const tiny = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const huge = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const v1 = check({ sql, estate: tiny, policy });
    const v2 = check({ sql, estate: huge, policy });
    expect(v1.violations.some((v) => v.rule_id === "R002")).toBe(true);
    expect(v2.violations.some((v) => v.rule_id === "R002")).toBe(true);
  });
});

