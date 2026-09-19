import { check, type PolicyResolved, type EstateSnapshot, computeFreshness } from "@nockhq/core";
import * as fs from "fs";
import { z } from "zod";
import { discoverSession, listNockFiles, readWorkspaceFile } from "./session.js";

export { discoverSession, listNockFiles, readWorkspaceFile, resolveWorkspaceRoot } from "./session.js";

function jsonContent(json: unknown) {
  return { content: [{ type: "json" as const, json }] };
}

// Start an MCP server using dynamic imports to avoid ESM resolution friction at build time.
export async function startMcpServer() {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js" as any);
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js" as any);

  // Create server (high-level API exposes tool registration)
  const server = new McpServer(
    { name: "@nockhq/mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Tool: get_session — IDE workspace snapshot (estate + files like local CLI)
  server.registerTool(
    "get_session",
    {
      title: "Nock session",
      description:
        "Returns the local IDE/workspace session: discovered estate, policy, and SQL files (the same local files the CLI uses).",
      inputSchema: z.object({ workspaceRoot: z.string().optional() }).strip(),
    },
    async (args: any) => jsonContent(discoverSession(args?.workspaceRoot ? String(args.workspaceRoot) : undefined))
  );

  // Tool: list_files
  server.registerTool(
    "list_files",
    {
      title: "List Nock files",
      description:
        "List local Nock files under the workspace: estate snapshots, policy, and migration SQL (fixtures/, migrations/, examples/, .nock/).",
      inputSchema: z.object({ workspaceRoot: z.string().optional() }).strip(),
    },
    async (args: any) =>
      jsonContent(listNockFiles(args?.workspaceRoot ? String(args.workspaceRoot) : undefined))
  );

  // Tool: read_file
  server.registerTool(
    "read_file",
    {
      title: "Read a Nock workspace file",
      description: "Read a local estate, policy, or SQL file from the workspace (paths must stay inside the workspace).",
      inputSchema: z
        .object({
          path: z.string(),
          workspaceRoot: z.string().optional(),
        })
        .strip(),
    },
    async (args: any) =>
      jsonContent(
        readWorkspaceFile(String(args?.path ?? ""), args?.workspaceRoot ? String(args.workspaceRoot) : undefined)
      )
  );

  // Tool: check_before_apply
  server.registerTool(
    "check_before_apply",
    {
      title: "Check migration before apply",
      description:
        "Returns Nock verdict JSON for a migration SQL string or sqlPath (like the local CLI --sql file). Prefers hosted estate (token) or local file; uses .nock/estate.json from the workspace session when estatePath is omitted. Optionally refreshes estate live from Postgres when databaseUrl/env is provided (experimental).",
      // Zod input schema for validation
      inputSchema: z
        .object({
          sql: z.string().optional(),
          sqlPath: z.string().optional(),
          workspaceRoot: z.string().optional(),
          pgVersion: z.string().optional(),
          estatePath: z.string().optional(),
          policyPath: z.string().optional(),
          estateApiUrl: z.string().optional(),
          estateApiToken: z.string().optional(),
          apiBaseUrl: z.string().optional(),
          databaseUrl: z.string().optional(),
        })
        .strip(),
    },
    async (args: any) => {
      const verdict = await checkBeforeApplyHostedOrLocal({
        sql: args?.sql ? String(args.sql) : undefined,
        sqlPath: args?.sqlPath ? String(args.sqlPath) : undefined,
        workspaceRoot: args?.workspaceRoot ? String(args.workspaceRoot) : undefined,
        pgVersion: args?.pgVersion ? String(args.pgVersion) : undefined,
        estatePath: args?.estatePath ? String(args.estatePath) : undefined,
        policyPath: args?.policyPath ? String(args.policyPath) : undefined,
        estateApiUrl: args?.estateApiUrl ? String(args.estateApiUrl) : undefined,
        estateApiToken: args?.estateApiToken ? String(args.estateApiToken) : undefined,
        apiBaseUrl: args?.apiBaseUrl ? String(args.apiBaseUrl) : undefined,
        databaseUrl: args?.databaseUrl ? String(args.databaseUrl) : undefined,
      });
      return jsonContent(verdict);
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

  await registerSessionFileResources(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function registerSessionFileResources(server: any) {
  if (typeof server.registerResource !== "function") return;
  try {
    server.registerResource(
      "session",
      "nock://session",
      {
        title: "Nock session",
        description: "Workspace session: discovered estate, policy, and SQL files",
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri: "nock://session",
            mimeType: "application/json",
            text: JSON.stringify(discoverSession(), null, 2),
          },
        ],
      })
    );
    server.registerResource(
      "files",
      "nock://files",
      {
        title: "Nock files",
        description: "Discovered local estate, policy, and SQL files",
        mimeType: "application/json",
      },
      async () => ({
        contents: [
          {
            uri: "nock://files",
            mimeType: "application/json",
            text: JSON.stringify(listNockFiles(), null, 2),
          },
        ],
      })
    );
  } catch {
    // Older SDK builds may not expose resources; tools still work.
  }
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
  sql?: string;
  sqlPath?: string;
  workspaceRoot?: string;
  pgVersion?: string;
  estatePath?: string;
  policyPath?: string;
  estateApiUrl?: string;
  estateApiToken?: string;
  apiBaseUrl?: string;
  databaseUrl?: string;
}) {
  let sql = args.sql ?? "";
  if (!sql.trim() && args.sqlPath) {
    sql = readWorkspaceFile(args.sqlPath, args.workspaceRoot).text;
  }
  if (!sql.trim()) {
    throw new Error("Provide sql or sqlPath (a workspace SQL file, like the local CLI --sql).");
  }

  // Optional live refresh (experimental Path C thin)
  const dbUrlEnv = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
  const dbUrl = (args.databaseUrl || dbUrlEnv || "").trim();
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
  if (dbUrl) {
    // Live sync from DB takes highest precedence when provided
    try {
      const { runSyncStats } = await import("./syncEstate.js");
      estate = await runSyncStats({ databaseUrl: dbUrl });
    } catch (err) {
      throw new Error(
        `Live estate refresh failed: ${(err as any)?.message || String(err)}`
      );
    }
  } else if (estateApiUrl && estateApiToken) {
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
    const session = discoverSession(args.workspaceRoot);
    const estatePath = args.estatePath || session.estatePath || undefined;
    if (estatePath) {
      estate = JSON.parse(fs.readFileSync(String(estatePath), "utf8")) as EstateSnapshot;
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
  const sessionPolicy = args.policyPath
    ? args.policyPath
    : discoverSession(args.workspaceRoot).policyPath;
  const policy: PolicyResolved =
    hostedPolicy ||
    (sessionPolicy
      ? (JSON.parse(fs.readFileSync(String(sessionPolicy), "utf8")) as PolicyResolved)
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
    sql,
    estate,
    policy,
    pgVersion: args.pgVersion,
    noStatsBehavior: band === "stale" ? "warn" : undefined,
  });
}


