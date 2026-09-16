import { describe, it, expect } from "vitest";
import { join } from "path";
import { readFileSync } from "fs";
import { spawnSync } from "node:child_process";
import { checkBeforeApplyLocal } from "../src/index.js";

function runCli(args: string[]) {
  const bin = join(__dirname, "../../cli/dist/bin/nock.js"); // not available; fallback to invoking from repo root
  // Use repo root relative path
  const rootBin = join(__dirname, "../../../packages/cli/dist/bin/nock.js");
  const res = spawnSync("node", [rootBin, ...args], { encoding: "utf8" });
  return { stdout: res.stdout, status: res.status };
}

describe("MCP check_before_apply ≡ CLI JSON", () => {
  it("Railway-shaped fixture parity", () => {
    const sqlPath = join(__dirname, "../../../fixtures/railway_oct.sql");
    const statsPath = join(__dirname, "../../../fixtures/stats_billion.json");
    const cli = runCli(["check", "--sql", sqlPath, "--stats", statsPath, "--format", "json"]);
    const cliJson = JSON.parse(cli.stdout);

    const verdict = checkBeforeApplyLocal({
      sql: readFileSync(sqlPath, "utf8"),
      statsPath
    });
    expect(cliJson.verdict).toEqual(verdict.verdict);
    expect(cliJson.violations.map((v: any) => v.rule_id).sort()).toEqual(
      verdict.violations.map((v) => v.rule_id).sort()
    );
  });
});

