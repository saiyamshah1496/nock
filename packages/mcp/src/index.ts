import { check, type PolicyResolved, type EstateSnapshot, computeFreshness } from "@nockhq/core";
import * as fs from "fs";
import { z } from "zod";

// Start an MCP server using dynamic imports to avoid ESM resolution friction at build time.
export async function startMcpServer() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js" as any);
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js" as any);

  // Create server (high-level API exposes tool registration)
  const server = new McpServer(
    { name: "@nockhq/mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // Tool: check_before_apply
  server.registerTool(
    "check_before_apply",
    {
      title: "Check migration before apply",
      description:
        "Returns Nock verdict JSON for a migration SQL against a hosted (token) or local estate snapshot (no DB connection).",
      // Zod input schema for validation
      inputSchema: z
        .object({
          sql: z.string(),
          pgVersion: z.string().optional(),
          estatePath: z.string().optional(),
          policyPath: z.string().optional(),
          estateApiUrl: z.string().optional(),
          estateApiToken: z.string().optional(),
          apiBaseUrl: z.string().optional(),
        })
        .strip(),
    },
    async (args: any) => {
      const verdict = await checkBeforeApplyHostedOrLocal({
        sql: String(args?.sql ?? ""),
        pgVersion: args?.pgVersion ? String(args.pgVersion) : undefined,
        estatePath: args?.estatePath ? String(args.estatePath) : undefined,
        policyPath: args?.policyPath ? String(args.policyPath) : undefined,
        estateApiUrl: args?.estateApiUrl ? String(args.estateApiUrl) : undefined,
        estateApiToken: args?.estateApiToken ? String(args.estateApiToken) : undefined,
        apiBaseUrl: args?.apiBaseUrl ? String(args.apiBaseUrl) : undefined,
      });
      return { content: [{ type: "json", json: verdict }] };
    }
  );

  // Tool: list_rules
  server.registerTool(
    "list_rules",
    {
      title: "List available rules",
      description: "Returns rule ids, titles, and default thresholds.",
    },
    async () => {
      return {
        content: [
          {
            type: "json",
            json: [
              { id: "R001", title: "Non-concurrent CREATE INDEX", default: { red_rows: 10000 } },
              { id: "R010", title: "Require lock_timeout on hot tables", default: { rows: 1000000 } },
              { id: "R004", title: "ADD COLUMN on hot table without lock_timeout", default: { rows: 1000000 } },
              { id: "R006", title: "ADD CHECK without NOT VALID", default: { red_rows: 50000 } },
              { id: "R005", title: "SET NOT NULL without validated CHECK", default: { red_rows: 100000 } },
              { id: "R012", title: "VACUUM FULL / CLUSTER / non-concurrent REINDEX", default: {} }
            ],
          },
        ],
      };
    }
  );

  // Tool: explain_lock
  server.registerTool(
    "explain_lock",
    {
      title: "Explain lock mode",
      description: "Given a single SQL statement, return the likely lock mode.",
      inputSchema: z
        .object({
          sql: z.string(),
        })
        .strip(),
    },
    async (args: any) => {
      const sql = String(args?.sql ?? "");
      const up = sql.trim().toUpperCase();
      let lock = "UNKNOWN";
      if (up.startsWith("CREATE INDEX") && !up.includes(" CONCURRENTLY ")) lock = "SHARE";
      else if (up.includes(" CONCURRENTLY ")) lock = "SHARE UPDATE EXCLUSIVE";
      return { content: [{ type: "text", text: `Lock mode: ${lock}` }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// If launched as a standalone process, start the server
if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function checkBeforeApplyLocal(args: {
  sql: string;
  pgVersion?: string;
  estatePath?: string;
  policyPath?: string;
}) {
  const estate: EstateSnapshot = args.estatePath
    ? JSON.parse(fs.readFileSync(String(args.estatePath), "utf8"))
    : { tables: [] };
  const policy: PolicyResolved = args.policyPath
    ? JSON.parse(fs.readFileSync(String(args.policyPath), "utf8"))
    : {
        id: "nock.postgres.ddl.default",
        version: "1.0.0",
        fail_on: "red",
        rules: {
          R001: { red_rows: 10000 },
          R010: { always_require_lock_timeout_above_rows: 1000000 }
        }
      };
  return check({ sql: args.sql, estate, policy, pgVersion: args.pgVersion });
}

// Test helper: mirrors tool logic (hosted preference with env fallbacks)
export async function checkBeforeApplyHostedOrLocal(args: {
  sql: string;
  pgVersion?: string;
  estatePath?: string;
  policyPath?: string;
  estateApiUrl?: string;
  estateApiToken?: string;
  apiBaseUrl?: string;
}) {
  const estateApiUrl: string = String(args?.estateApiUrl || "");
  const tokenInput: string = String(args?.estateApiToken || "");
  const tokenEnv =
    process.env.NOCK_TEAM_API_TOKEN ||
    process.env.NOCK_ESTATE_API_TOKEN ||
    process.env.NOCK_STATS_API_TOKEN ||
    "";
  const estateApiToken = tokenInput || tokenEnv;
  const apiBaseUrl: string = String(args?.apiBaseUrl || "");
  const apiBase = apiBaseUrl
    ? apiBaseUrl.replace(/\/+$/, "")
    : estateApiUrl
    ? new URL(estateApiUrl).origin
    : "";
  let estate: EstateSnapshot | null = null;
  if (estateApiUrl && estateApiToken) {
    try {
      const res = await fetch(estateApiUrl, {
        headers: { Accept: "application/json", Authorization: `Bearer ${estateApiToken}` },
      });
      if (res.ok) estate = (await res.json()) as EstateSnapshot;
    } catch {
      // ignore
    }
  }
  if (!estate) {
    if (args.estatePath) {
      estate = JSON.parse(fs.readFileSync(String(args.estatePath), "utf8")) as EstateSnapshot;
    } else {
      throw new Error(
        "Either provide estatePath, or configure estateApiUrl with a valid token."
      );
    }
  }
  let hostedPolicy: PolicyResolved | null = null;
  if (apiBase && estateApiToken) {
    try {
      let repoId: string | null = null;
      try {
        const u = new URL(estateApiUrl);
        const m = /\/v1\/estate\/(.+)$/.exec(u.pathname);
        if (m && m[1]) repoId = decodeURIComponent(m[1]);
      } catch {
        // ignore
      }
      if (repoId) {
        const res = await fetch(`${apiBase}/v1/policy/${encodeURIComponent(repoId)}`, {
          headers: { Accept: "application/json", Authorization: `Bearer ${estateApiToken}` },
        });
        if (res.ok) hostedPolicy = (await res.json()) as PolicyResolved;
      }
    } catch {
      // ignore
    }
  }
  const policy: PolicyResolved =
    hostedPolicy ||
    (args.policyPath
      ? (JSON.parse(fs.readFileSync(String(args.policyPath), "utf8")) as PolicyResolved)
      : {
          id: "nock.postgres.ddl.default",
          version: "1.0.0",
          fail_on: "red",
          rules: {
            R001: { red_rows: 10000 },
            R010: { always_require_lock_timeout_above_rows: 1000000 },
          },
        });
  const band = computeFreshness(estate.captured_at);
  return check({
    sql: args.sql,
    estate,
    policy,
    pgVersion: args.pgVersion,
    noStatsBehavior: band === "stale" ? "warn" : undefined,
  });
}


