#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { check, type PolicyResolved, type StatsSnapshot } from "@nock/core";

const program = new Command();
program
  .name("nock")
  .description("Nock — Postgres migration safety gate (sizes × lock modes × policy)")
  .version("0.1.0");

program
  .command("check")
  .requiredOption("--sql <path>", "Path to a SQL file to check")
  .requiredOption("--stats <path>", "Path to a stats.json file")
  .option("--policy <path>", "Path to a policy YAML or JSON (JSON in Phase 1)")
  .option("--pg-version <ver>", "Override Postgres version string")
  .option("--format <fmt>", "Output format: json|text", "json")
  .option("--fail-on <level>", "Fail on red|yellow", "red")
  .action((opts) => {
    const sqlPath = path.resolve(String(opts.sql));
    const statsPath = path.resolve(String(opts.stats));
    const policyPath = opts.policy ? path.resolve(String(opts.policy)) : null;
    const sql = fs.readFileSync(sqlPath, "utf8");
    const stats: StatsSnapshot = JSON.parse(fs.readFileSync(statsPath, "utf8"));

    // Minimal default policy if none provided
    let policy: PolicyResolved = policyPath
      ? JSON.parse(fs.readFileSync(policyPath, "utf8"))
      : {
          id: "nock.postgres.ddl.default",
          version: "1.0.0",
          fail_on: (String(opts.failOn) as "red" | "yellow") ?? "red",
          rules: {
            R001: { red_rows: 10000 },
            R010: { always_require_lock_timeout_above_rows: 1000000 }
          }
        };
    // Allow override of fail-on via CLI even if policy file present (lowest friction)
    if (opts.failOn) {
      policy = { ...policy, fail_on: String(opts.failOn) as any };
    }

    const verdict = check({
      sql,
      stats,
      policy,
      pgVersion: opts.pgVersion ? String(opts.pgVersion) : undefined
    });

    if (opts.format === "json") {
      process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
    } else {
      // Text projection minimal
      process.stdout.write(
        `${verdict.verdict.toUpperCase()} — ${verdict.violations.length} violation(s)\n`
      );
    }

    const hasRed = verdict.violations.some((v) => v.severity === "red");
    const hasYellow = verdict.violations.some((v) => v.severity === "yellow");
    let code = 0;
    const failOn = policy.fail_on ?? "red";
    if (failOn === "red") code = hasRed ? 2 : 0;
    else code = hasRed ? 2 : hasYellow ? 1 : 0;
    process.exit(code);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(2);
});

