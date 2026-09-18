import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R022 — VALIDATE CONSTRAINT on hot table", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/validate_constraint.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );

  it("reds on large table when constraint not yet validated", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      constraints: [
        ...(bigEstate.constraints ?? []),
        { schema: "public", table: "sessions", name: "sessions_archived_at_nn", kind: "check", validated: false, columns: ["archived_at"] }
      ],
      indexes: bigEstate.indexes ?? []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R022: { yellow_rows: 10000, red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R022");
    expect(r?.severity).toBe("red");
  });

  it("yellows on medium table size between thresholds", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      tables: [{ schema: "public", name: "sessions", n_live_tup: 20000 }],
      constraints: [{ schema: "public", table: "sessions", name: "sessions_archived_at_nn", kind: "check", validated: false, columns: ["archived_at"] }],
      indexes: []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R022: { yellow_rows: 10000, red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R022");
    expect(r?.severity).toBe("yellow");
  });

  it("suppresses when already validated in catalogue", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      constraints: [
        { schema: "public", table: "sessions", name: "sessions_archived_at_nn", kind: "check", validated: true, columns: ["archived_at"] }
      ],
      indexes: []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R022: { yellow_rows: 10000, red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R022");
    expect(r).toBeUndefined();
  });

  it("fires using SQL table when constraints section omitted (fail-closed on catalogue)", () => {
    const estate: EstateSnapshot = { ...bigEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).constraints;
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R022: { yellow_rows: 10000, red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R022");
    expect(r?.severity).toBe("red");
  });

  it("does not fire when disabled via knob", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      constraints: [
        { schema: "public", table: "sessions", name: "sessions_archived_at_nn", kind: "check", validated: false, columns: ["archived_at"] }
      ],
      indexes: []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R022: { enabled: false } } };
    const v = check({ sql, estate, policy });
    const r = v.violations.find((x) => x.rule_id === "R022");
    expect(r).toBeUndefined();
  });
});

