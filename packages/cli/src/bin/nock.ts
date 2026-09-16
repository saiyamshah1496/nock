#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { check, type PolicyResolved, type StatsSnapshot } from "@nock/core";
import { runSyncStats } from "../syncStats";
import { envelopeEncrypt } from "@nock/secure-stats";
import https from "https";
import { URL } from "url";

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

program
  .command("sync-stats")
  .requiredOption("--database-url <url>", "Postgres connection string (prefer replica; stats-only role)")
  .requiredOption("--out <path>", "Path to write stats.json")
  .option(
    "--sql-file <path>",
    "Optional override: path to a .sql file to run instead of the default catalogue query"
  )
  .option("--push-url <url>", "Optional: POST to hosted API after writing the file")
  .option("--token <token>", "Optional: bearer token for hosted API")
  .action(async (opts) => {
    const databaseUrl = String(opts.databaseUrl);
    const outPath = path.resolve(String(opts.out));
    const sqlFilePath = opts.sqlFile ? path.resolve(String(opts.sqlFile)) : undefined;
    try {
      const snapshot = await runSyncStats({ databaseUrl, sqlFilePath });
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
      process.stdout.write(`Wrote stats to ${outPath}\n`);
      if (opts.pushUrl) {
        const pushUrl = String(opts.pushUrl);
        const token = opts.token ? String(opts.token) : "";
        const devPlain = process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
        let body: any;
        if (devPlain) {
          body = snapshot;
        } else {
          const kek = process.env.NOCK_STATS_KEK;
          if (!kek) {
            throw new Error("When using --push-url, set NOCK_DEV_PLAINTEXT_STATS=1 (local only) or provide NOCK_STATS_KEK (base64 32 bytes) to encrypt.");
          }
          body = envelopeEncrypt(snapshot, kek);
        }
        await postJson(pushUrl, body, token);
        process.stdout.write(`Pushed stats to ${pushUrl}\n`);
      }
      process.exit(0);
    } catch (err: any) {
      console.error(err?.message || String(err));
      process.exit(2);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(2);
});

function postJson(urlStr: string, obj: any, token?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = Buffer.from(JSON.stringify(obj), "utf8");
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            const msg = Buffer.concat(chunks).toString("utf8");
            reject(new Error(`Push failed: ${res.statusCode} ${msg}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

