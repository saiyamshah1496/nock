import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

const hotEstate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
const tinyEstate = {
  schema_version: "1",
  captured_at: "2026-09-16T05:00:00Z",
  pg_version: "16.4",
  source: "fixture",
  tables: [{ schema: "public", name: "sessions", n_live_tup: 100 }]
};

const policy = {
  id: "nock.postgres.ddl.default",
  version: "1.0.0",
  fail_on: "red",
  rules: {
    R003: { red_rows: 100000 },
    R004: { hot_rows: 1000000, require_lock_timeout: true },
    R010: { always_require_lock_timeout_above_rows: 1000000 }
  }
};

describe("R003 — ADD COLUMN volatile DEFAULT implies rewrite on hot estates", () => {
  it("reds on DEFAULT random()", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_random.sql"), "utf8");
    const verdict = check({ sql, estate: hotEstate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R003");
  });

  it("reds on DEFAULT gen_random_uuid()", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_uuid.sql"), "utf8");
    const verdict = check({ sql, estate: hotEstate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R003");
  });

  it("reds on DEFAULT nextval(...)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_nextval.sql"), "utf8");
    const verdict = check({ sql, estate: hotEstate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).toContain("R003");
  });

  it("does not fire on constant defaults on hot table (R004 may still fire)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_constants.sql"), "utf8");
    const verdict = check({ sql, estate: hotEstate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R003");
    // Sanity: R004 applies to hot ADD COLUMN without lock_timeout
    expect(ids).toContain("R004");
  });

  it("does not red on now()/CURRENT_TIMESTAMP", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_nowish.sql"), "utf8");
    const verdict = check({ sql, estate: hotEstate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R003");
  });

  it("tiny estate with volatile default passes size gate", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/addcol_default_random.sql"), "utf8");
    const verdict = check({ sql, estate: tinyEstate as any, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R003");
  });
});

