import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";
import { check, type PolicyResolved, type StatsSnapshot } from "@nock/core";
import https from "https";
import { URL } from "url";

async function run() {
  try {
    const migrationPath = core.getInput("migration-path") || "migrations/";
    const statsPath = core.getInput("stats-path") || ".nock/stats.json";
    const statsApiUrl = core.getInput("stats-api-url") || "";
    const statsApiToken = core.getInput("stats-api-token") || "";
    const policyPath = core.getInput("policy-path") || "policy.default.yml";
    const failOn = (core.getInput("fail-on") || "red") as "red" | "yellow";
    const token = core.getInput("github-token");

    // Collect SQL files (simple: if path is a file, read it; if dir, read *.sql)
    const absPath = path.resolve(migrationPath);
    let sqlFiles: string[] = [];
    const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
    if (stat?.isFile()) {
      sqlFiles = [absPath];
    } else if (stat?.isDirectory()) {
      sqlFiles = fs
        .readdirSync(absPath)
        .filter((f) => f.toLowerCase().endsWith(".sql"))
        .map((f) => path.join(absPath, f));
    } else {
      core.warning(`No SQL found at ${migrationPath}`);
    }
    const sql = sqlFiles.map((p) => fs.readFileSync(p, "utf8")).join("\n;\n");

    let stats: StatsSnapshot | null = null;
    if (statsApiUrl) {
      try {
        const res = await getJson(statsApiUrl, statsApiToken);
        stats = res as StatsSnapshot;
      } catch (e: any) {
        core.warning(`Failed to fetch stats from API: ${e?.message || String(e)}`);
      }
    }
    if (!stats) {
      stats = fs.existsSync(statsPath)
        ? JSON.parse(fs.readFileSync(statsPath, "utf8"))
        : ({ tables: [] } as any);
    }
    // Warn if stale >24h
    if ((stats as any).captured_at) {
      const cap = new Date(String((stats as any).captured_at)).getTime();
      if (Number.isFinite(cap)) {
        const ageMs = Date.now() - cap;
        if (ageMs > 24 * 3600 * 1000) {
          core.warning("Stats appear older than 24h; results may be stale.");
        }
      }
    }
    const policy: PolicyResolved = fs.existsSync(policyPath)
      ? JSON.parse(fs.readFileSync(policyPath, "utf8"))
      : {
          id: "nock.postgres.ddl.default",
          version: "1.0.0",
          fail_on: failOn,
          rules: {
            R001: { red_rows: 10000 },
            R010: { always_require_lock_timeout_above_rows: 1000000 }
          }
        };

    const verdict = check({ sql, stats, policy });
    core.setOutput("verdict", JSON.stringify(verdict));

    const octokit = github.getOctokit(token);
    const context = github.context;
    if (context.payload.pull_request) {
      const { owner, repo } = context.repo;
      const prNumber = context.payload.pull_request.number;
      const body = renderComment(verdict);
      // Upsert by marker
      const existing = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber
      });
      const markerStart = "<!-- nock:verdict -->";
      const found = existing.data.find((c) => c.body && c.body.includes(markerStart));
      if (found) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: found.id,
          body
        });
      } else {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body
        });
      }
    }

    const hasRed = verdict.violations.some((v) => v.severity === "red");
    const hasYellow = verdict.violations.some((v) => v.severity === "yellow");
    if (failOn === "red") {
      if (hasRed) core.setFailed("Nock verdict: RED");
    } else {
      if (hasRed || hasYellow) core.setFailed("Nock verdict: RED/YELLOW");
    }
  } catch (err: any) {
    core.setFailed(err?.stack || String(err));
  }
}

function fmt(num?: number): string {
  if (num === undefined) return "?";
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(2) + "k";
  return String(num);
}

function renderComment(verdict: ReturnType<typeof check extends (a: any) => infer R ? () => R : never> extends () => infer T ? T : any): string {
  const badge = verdict.verdict === "fail" ? "Nock RED/YELLOW" : "Nock PASS";
  const lines: string[] = [];
  lines.push("<!-- nock:verdict -->");
  lines.push(`### ${badge}`);
  for (const s of verdict.statements) {
    const table = s.target ? `${s.target.schema}.${s.target.name}` : "unknown";
    lines.push(
      `\n\`${s.sql.trim().slice(0, 200)}\` → lock **${s.lock_mode}**, blocks_writes: ${s.blocks_writes}\n`
    );
    lines.push(`Table ${table}: **${fmt(s.n_live_tup)}** live rows`);
    if (s.estimated_hold_ms) {
      const min = Math.round((s.estimated_hold_ms.min || 0) / 60000);
      const max = Math.round((s.estimated_hold_ms.max || 0) / 60000);
      lines.push(`Estimated hold **${min}–${max} min** (approx.)`);
    }
    if (s.rules_hit.length) {
      lines.push(`Rules: ${s.rules_hit.join(", ")}`);
    }
  }
  if (verdict.violations.length) {
    const v = verdict.violations[0];
    if (v.remediation_sql) {
      lines.push("\n**Fix**");
      lines.push("```sql");
      lines.push(`SET lock_timeout = '3s';`);
      lines.push(v.remediation_sql);
      lines.push("```");
    }
  }
  lines.push("<!-- /nock:verdict -->");
  return lines.join("\n");
}

run();

function getJson(urlStr: string, token?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        method: "GET",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error("Invalid JSON from API"));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

