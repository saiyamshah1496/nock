import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type EstateSnapshot } from "../src/index";

describe("R007 — extra yellow when no supporting index on FK columns (catalogue arm)", () => {
  const sql = readFileSync(join(__dirname, "../../../fixtures/add_fk_without_not_valid.sql"), "utf8");
  const bigEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const tinyEstate: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8")
  );

  it("adds yellow for missing supporting index when catalogue sections present", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      // Explicitly present-but-empty constraints/indexes arrays (synced; none)
      constraints: [],
      indexes: []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: { R007: { red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const hits = v.violations.filter((x) => x.rule_id === "R007").map((x) => x.severity);
    expect(hits).toContain("yellow"); // extra yellow
  });

  it("does not add extra yellow when supporting index exists (prefix/equal)", () => {
    const estate: EstateSnapshot = {
      ...tinyEstate,
      constraints: [],
      indexes: [
        {
          schema: "public",
          table: "sessions",
          name: "idx_sessions_user_id_extra",
          unique: false,
          primary: false,
          valid: true,
          ready: true,
          live: true,
          immediate: true,
          columns: ["user_id", "archived_at"]
        }
      ]
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: { R007: { red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const yellow = v.violations.find((x) => x.rule_id === "R007" && x.severity === "yellow");
    expect(yellow).toBeUndefined();
  });

  it("red for large table still fires; extra yellow also present when no index", () => {
    const estate: EstateSnapshot = {
      ...bigEstate,
      constraints: [],
      indexes: []
    };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R007: { red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const reds = v.violations.filter((x) => x.rule_id === "R007" && x.severity === "red");
    expect(reds.length).toBeGreaterThan(0);
    const yellows = v.violations.filter((x) => x.rule_id === "R007" && x.severity === "yellow");
    expect(yellows.length).toBeGreaterThan(0);
  });

  it("no extra yellow when catalogue sections omitted (fail-closed)", () => {
    const estate: EstateSnapshot = { ...tinyEstate };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).constraints;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (estate as any).indexes;
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "yellow", rules: { R007: { red_rows: 100000 } } };
    const v = check({ sql, estate, policy });
    const yellow = v.violations.find((x) => x.rule_id === "R007" && x.severity === "yellow");
    expect(yellow).toBeUndefined();
  });
});

