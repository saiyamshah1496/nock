import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { check } from "../src/index";

describe("R001 — non-concurrent CREATE UNIQUE INDEX", () => {
  const policy = {
    id: "nock.postgres.ddl.default",
    version: "1.0.0",
    fail_on: "red",
    rules: {
      R001: { red_rows: 10000 },
      R010: { always_require_lock_timeout_above_rows: 1000000 }
    }
  };

  it("fails RED on billion-row estate", () => {
    const sql = `CREATE UNIQUE INDEX idx_sessions_archived_at ON sessions (archived_at);`;
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    const r001 = verdict.violations.find((v) => v.rule_id === "R001");
    expect(verdict.verdict).toBe("fail");
    expect(ids).toContain("R001");
    expect(r001?.severity).toBe("red");
    const stmt = verdict.statements.find((s) => s.sql.includes("CREATE UNIQUE INDEX"));
    expect(stmt?.lock_mode).toBe("SHARE");
  });

  it("passes silently on tiny estate (size gate)", () => {
    const sql = `CREATE UNIQUE INDEX idx_sessions_archived_at ON sessions (archived_at);`;
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_tiny.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(verdict.verdict).toBe("pass");
    expect(ids).not.toContain("R001");
  });

  it("does not fire on CONCURRENTLY", () => {
    const sql = `CREATE UNIQUE INDEX CONCURRENTLY idx_sessions_archived_at ON sessions (archived_at);`;
    const estate = JSON.parse(readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8"));
    const verdict = check({ sql, estate, policy });
    const ids = verdict.violations.map((v) => v.rule_id);
    expect(ids).not.toContain("R001");
  });
});

