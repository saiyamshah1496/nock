import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check, type PolicyResolved } from "../../core/src/index";
import { renderComment } from "../src/format";

describe("Action comment formatter — explain-a-block", () => {
  it("renders rule/table/estate size/remediation fenced with markers", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/railway_oct.sql"), "utf8");
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const policy: PolicyResolved = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: {
        R001: { red_rows: 10000 },
        R010: { always_require_lock_timeout_above_rows: 1000000 }
      }
    } as any;
    const verdict = check({ sql, estate, policy });
    const md = renderComment(verdict);
    expect(md).toContain("<!-- nock:verdict -->");
    expect(md).toMatch(/R001\b/);
    expect(md).toMatch(/public\.sessions/);
    expect(md).toMatch(/n_live_tup.*≈\s*1\.04B/);
    expect(md).toContain("```sql");
    expect(md).toContain("```");
  });
});

