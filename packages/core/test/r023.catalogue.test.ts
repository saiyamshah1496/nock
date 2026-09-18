import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R023 — Invalid or not-ready index on touched table", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/add_column_default.sql"), "utf8"); // touches public.sessions
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );

  it("yellows when any index on touched table is invalid", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_bad",
          unique: false,
          primary: false,
          valid: false,
          ready: true,
          live: false,
          immediate: false,
          columns: ["archived_at"]
        }
      ]
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: {} };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r?.severity).toBe("yellow");
  });

  it("yellows when any index on touched table is not-ready", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_not_ready",
          unique: false,
          primary: false,
          valid: true,
          ready: false,
          live: false,
          immediate: false,
          columns: ["archived_at"]
        }
      ]
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: {} };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r?.severity).toBe("yellow");
  });

  it("does not fire when indexes section omitted (fail-closed)", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).indexes;
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: {} };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r).toBeUndefined();
  });

  it("does not fire with empty [] indexes (no match)", () => {
    const estate: EstateSnapshot = { ...bigEstate, indexes: [] };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: {} };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r).toBeUndefined();
  });

  it("does not fire for indexes on other tables", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "other_table",
          name: "idx_other",
          unique: false,
          primary: false,
          valid: false,
          ready: true,
          live: false,
          immediate: false,
          columns: ["c"]
        }
      ]
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: {} };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r).toBeUndefined();
  });

  it("does not fire when disabled via knob", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_bad",
          unique: false,
          primary: false,
          valid: false,
          ready: true,
          live: false,
          immediate: false,
          columns: ["archived_at"]
        }
      ]
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: { R023: { enabled: false } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R023");
    expect(r).toBeUndefined();
  });
});

