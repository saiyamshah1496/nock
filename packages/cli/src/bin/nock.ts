#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { check, type PolicyResolved, type EstateSnapshot, evaluateEstateFreshness } from "@nockhq/core";
import { runSyncStats } from "../syncStats";
import { envelopeEncrypt } from "@nockhq/secure-estate";
import https from "https";
import http from "http";
import { URL } from "url";

const program = new Command();
program
  .name("nock")
  .description("Nock — Postgres migration safety gate (sizes × lock modes × policy)")
  .version("0.1.0");

program
  .command("check")
  .requiredOption("--sql <path>", "Path to a SQL file to check")
  .requiredOption("--estate <path>", "Path to an estate.json file")
  .option("--policy <path>", "Path to a policy YAML or JSON (JSON in Phase 1)")
  .option("--pg-version <ver>", "Override Postgres version string")
  .option("--format <fmt>", "Output format: json|text", "json")
  .option("--fail-on <level>", "Fail on red|yellow", "red")
  .action((opts) => {
    const sqlPath = path.resolve(String(opts.sql));
    const estatePath = path.resolve(String(opts.estate));
    const policyPath = opts.policy ? path.resolve(String(opts.policy)) : null;
    const sql = fs.readFileSync(sqlPath, "utf8");
    const estate: EstateSnapshot = JSON.parse(fs.readFileSync(estatePath, "utf8"));

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

    const fres = evaluateEstateFreshness(estate);
    if (fres.classification === "warn") {
      console.warn("Warning: estate snapshot appears older than 7 days; results may be stale.");
    } else if (fres.classification === "neutral_stale") {
      console.warn("Warning: estate snapshot is older than 30 days; size-gated rules will be neutralized.");
    }
    const verdict = check({
      sql,
      estate,
      policy,
      pgVersion: opts.pgVersion ? String(opts.pgVersion) : undefined,
      noStatsBehavior: fres.classification === "neutral_stale" ? "warn" : undefined,
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
  .command("sync-estate")
  .requiredOption("--database-url <url>", "Postgres connection string (prefer replica; read-only)")
  .requiredOption("--out <path>", "Path to write estate.json")
  .option(
    "--sql-file <path>",
    "Optional override: path to a .sql file to run instead of the default catalogue query"
  )
  .option("--push-url <url>", "Optional: POST to hosted estate API after writing the file")
  .option("--token <token>", "Optional: bearer token for hosted API")
  .action(async (opts) => {
    const databaseUrl = String(opts.databaseUrl);
    const outPath = path.resolve(String(opts.out));
    const sqlFilePath = opts.sqlFile ? path.resolve(String(opts.sqlFile)) : undefined;
    try {
      const snapshot = await runSyncStats({ databaseUrl, sqlFilePath });
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
      process.stdout.write(`Wrote estate to ${outPath}\n`);
      if (opts.pushUrl) {
        const pushUrl = String(opts.pushUrl);
        const token = opts.token ? String(opts.token) : "";
        const devPlain = process.env.NOCK_DEV_PLAINTEXT_ESTATE === "1" || process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
        let body: any;
        if (devPlain) {
          body = snapshot;
        } else {
          const kek = process.env.NOCK_ESTATE_KEK || process.env.NOCK_STATS_KEK;
          if (!kek) {
            throw new Error(
              "When using --push-url, set NOCK_DEV_PLAINTEXT_ESTATE=1 (local only) or provide NOCK_ESTATE_KEK (base64 32 bytes) to encrypt."
            );
          }
          body = envelopeEncrypt(snapshot, kek);
        }
        await postJson(pushUrl, body, token);
        process.stdout.write(`Pushed estate to ${pushUrl}\n`);
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
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
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

