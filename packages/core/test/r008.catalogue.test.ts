import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R008 — catalogue-aware soften for ALTER TYPE", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/alter_type_int_to_bigint.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );

  it("softens when columns[] shows known-safe widen int->bigint (catalogue present)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: [
        ...(bigEstate.columns ?? []),
        { schema: "public", table: "sessions", column: "archived_at", not_null: false, type_name: "integer" }
      ],
      constraints: bigEstate.constraints ?? [],
      indexes: bigEstate.indexes ?? []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R008: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.rule_id === "R008")).toBe(false);
  });

  it("stays advisory when columns[] key is omitted (fail-closed for new arm)", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).columns;
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R008: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.rule_id === "R008")).toBe(true);
  });

  it("stays advisory when columns[] present but empty (no match)", () => {
    const estate: EstateSnapshot = { ...bigEstate, columns: [], constraints: bigEstate.constraints ?? [], indexes: bigEstate.indexes ?? [] };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R008: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.rule_id === "R008")).toBe(true);
  });

  it("does not soften when type_name mismatches (e.g., text->bigint not a safe widen)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: [
        { schema: "public", table: "sessions", column: "archived_at", not_null: false, type_name: "text" }
      ],
      constraints: [],
      indexes: []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R008: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.rule_id === "R008")).toBe(true);
  });

  it("knob-off: soften_with_catalogue=false disables soften even on safe widen", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: [
        { schema: "public", table: "sessions", column: "archived_at", not_null: false, type_name: "integer" }
      ],
      constraints: [],
      indexes: []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R008: { red_rows: 10000, soften_with_catalogue: false } }
    };
    const v = check({ sql, estate, policy });
    expect(v.violations.some((x) => x.rule_id === "R008")).toBe(true);
  });
});

