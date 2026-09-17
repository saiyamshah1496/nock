import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R013 — REFRESH MATERIALIZED VIEW without CONCURRENTLY", () => {
  it("reds at ≥10k rows when estate known", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/refresh_mv_plain.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R013: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const v = verdict.violations.find((x) => x.rule_id === "R013");
    expect(v?.severity).toBe("red");
  });

  it("yellows when size unknown", () => {
    const sql = `REFRESH MATERIALIZED VIEW public.unknown_view;`;
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: { R013: { red_rows: 10000 } } };
    const verdict = check({ sql, estate, policy });
    const v = verdict.violations.find((x) => x.rule_id === "R013");
    expect(v?.severity).toBe("yellow");
  });
});

