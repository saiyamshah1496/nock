import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("Unknown DDL → YELLOW (never silent green)", () => {
  it("yields yellow parse violation", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/unknown_ddl.sql"), "utf8");
    const estate = { tables: [] };
    const policy = { id: "nock.postgres.ddl.default", version: "1.0.0", fail_on: "red", rules: {} };
    const verdict = check({ sql, estate, policy } as any);
    const unk = verdict.violations.find((v) => v.rule_id === "PARSE_UNKNOWN");
    expect(unk?.severity).toBe("yellow");
  });
});

