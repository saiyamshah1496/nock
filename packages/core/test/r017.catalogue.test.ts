import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R017 — catalogue-aware suppress when USING INDEX equivalent exists", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/add_unique_pk.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const tinyEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8")
  );

  it("suppresses R017 red when matching valid/ready/immediate unique index exists (order-sensitive match)", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        ...(bigEstate.indexes ?? []),
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_id_unique",
          unique: true,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["id"]
        }
      ]
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r).toBeUndefined();
  });

  it("does not suppress when indexes section is omitted (fail-closed)", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).indexes;
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r?.severity).toBe("red");
  });

  it("does not suppress when index columns mismatch", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_name_unique",
          unique: true,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["name"]
        }
      ]
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r?.severity).toBe("red");
  });

  it("does not suppress when index is invalid/not ready/not immediate", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_id_unique",
          unique: true,
          primary: false,
          valid: false, // invalid
          ready: true,
          live: true,
          immediate: true,
          columns: ["id"]
        }
      ]
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r?.severity).toBe("red");
  });

  it("does not suppress yellow hits on tiny estates (warn-only remains)", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_id_unique",
          unique: true,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["id"]
        }
      ]
    };
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: { R017: { red_rows: 10000 } }
    };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R017");
    expect(r?.severity).toBe("yellow");
  });
});

