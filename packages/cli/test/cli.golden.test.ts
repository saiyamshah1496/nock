import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "path";
import { check } from "@nock/core";
import { readFileSync } from "fs";

function runCli(args: string[]) {
  const bin = join(__dirname, "../dist/bin/nock.js");
  const res = spawnSync("node", [bin, ...args], { encoding: "utf8" });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

describe("CLI JSON equals core.check JSON on same inputs", () => {
  it("Railway-shaped fixture", () => {
    const sql = join(__dirname, "../../../fixtures/railway_oct.sql");
    const stats = join(__dirname, "../../../fixtures/stats_billion.json");
    const res = runCli(["check", "--sql", sql, "--stats", stats, "--format", "json"]);
    const cliJson = JSON.parse(res.stdout);

    const statsJson = JSON.parse(readFileSync(stats, "utf8"));
    const policy = {
      id: "nock.postgres.ddl.default",
      version: "1.0.0",
      fail_on: "red",
      rules: {
        R001: { red_rows: 10000 },
        R010: { always_require_lock_timeout_above_rows: 1000000 }
      }
    };
    const coreJson = check({ sql: readFileSync(sql, "utf8"), stats: statsJson, policy });

    // Compare selective fields to avoid incidental differences
    expect(cliJson.verdict).toEqual(coreJson.verdict);
    expect(cliJson.violations.map((v: any) => v.rule_id).sort()).toEqual(
      coreJson.violations.map((v) => v.rule_id).sort()
    );
  });
});

