import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R005 — catalogue-aware soften for SET NOT NULL", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/set_not_null.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );

  it("softens RED→YELLOW when columns[] has not_null:true for target column (fresh catalogue present)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: [
        ...(bigEstate.columns ?? []),
        { schema: "public", table: "sessions", column: "archived_at", not_null: true, type_name: "timestamptz" }
      ],
      constraints: bigEstate.constraints ?? [],
      indexes: bigEstate.indexes ?? []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R005");
    expect(r?.severity).toBe("yellow");
  });

  it("softens RED→YELLOW when constraints[] has validated CHECK covering column (fresh catalogue present)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: bigEstate.columns ?? [],
      constraints: [
        ...(bigEstate.constraints ?? []),
        { schema: "public", table: "sessions", name: "sessions_archived_at_nn", kind: "check", validated: true, columns: ["archived_at"] }
      ],
      indexes: bigEstate.indexes ?? []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R005");
    expect(r?.severity).toBe("yellow");
  });

  it("stays RED when catalogue sections are omitted (fail-closed)", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // Omit both keys entirely
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).columns;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).constraints;
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R005");
    expect(r?.severity).toBe("red");
  });

  it("stays RED when catalogue arrays are present but empty (no match)", () => {
    const estate: EstateSnapshot = { ...bigEstate, columns: [], constraints: [], indexes: bigEstate.indexes ?? [] };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R005");
    expect(r?.severity).toBe("red");
  });

  it("does not soften when soften_with_catalogue=false knob set", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      columns: [
        { schema: "public", table: "sessions", column: "archived_at", not_null: true, type_name: "timestamptz" }
      ],
      constraints: [],
      indexes: []
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R005: { red_rows: 100000, soften_with_catalogue: false } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R005");
    expect(r?.severity).toBe("red");
  });
});

