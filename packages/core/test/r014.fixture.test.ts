import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R014 — ATTACH/DETACH PARTITION risk", () => {
  it("ATTACH stays yellow on both tiny and large estates", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/attach_partition.sql"), "utf8");
    const tiny = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const big = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R014: { red_rows: 100000 } } };
    const v1 = check({ sql, estate: tiny, policy });
    const v2 = check({ sql, estate: big, policy });
    const y = v1.violations.find((x) => x.rule_id === "R014");
    expect(y?.severity).toBe("yellow");
    const y2 = v2.violations.find((x) => x.rule_id === "R014");
    expect(y2?.severity).toBe("yellow");
  });

  it("DETACH without CONCURRENTLY is red on hot parent, yellow on tiny", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/detach_partition.sql"), "utf8");
    const tiny = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const big = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R014: { red_rows: 100000 } } };
    const v1 = check({ sql, estate: tiny, policy });
    const v2 = check({ sql, estate: big, policy });
    const y = v1.violations.find((x) => x.rule_id === "R014");
    const r = v2.violations.find((x) => x.rule_id === "R014");
    expect(y?.severity).toBe("yellow");
    expect(r?.severity).toBe("red");
  });

  it("DETACH CONCURRENTLY stays yellow even on hot parent", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/detach_partition_concurrently.sql"), "utf8");
    const big = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R014: { red_rows: 100000 } } };
    const v = check({ sql, estate: big, policy });
    const y = v.violations.find((x) => x.rule_id === "R014");
    expect(y?.severity).toBe("yellow");
  });
});

