#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const core_1 = require("@nock/core");
const program = new commander_1.Command();
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
    const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
    // Minimal default policy if none provided
    let policy = policyPath
        ? JSON.parse(fs.readFileSync(policyPath, "utf8"))
        : {
            id: "nock.postgres.ddl.default",
            version: "1.0.0",
            fail_on: String(opts.failOn) ?? "red",
            rules: {
                R001: { red_rows: 10000 },
                R010: { always_require_lock_timeout_above_rows: 1000000 }
            }
        };
    // Allow override of fail-on via CLI even if policy file present (lowest friction)
    if (opts.failOn) {
        policy = { ...policy, fail_on: String(opts.failOn) };
    }
    const verdict = (0, core_1.check)({
        sql,
        stats,
        policy,
        pgVersion: opts.pgVersion ? String(opts.pgVersion) : undefined
    });
    if (opts.format === "json") {
        process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
    }
    else {
        // Text projection minimal
        process.stdout.write(`${verdict.verdict.toUpperCase()} — ${verdict.violations.length} violation(s)\n`);
    }
    const hasRed = verdict.violations.some((v) => v.severity === "red");
    const hasYellow = verdict.violations.some((v) => v.severity === "yellow");
    let code = 0;
    const failOn = policy.fail_on ?? "red";
    if (failOn === "red")
        code = hasRed ? 2 : 0;
    else
        code = hasRed ? 2 : hasYellow ? 1 : 0;
    process.exit(code);
});
program.parseAsync(process.argv).catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(2);
});
//# sourceMappingURL=nock.js.map