import { check } from "@nock/core";
import * as fs from "fs";
// Start an MCP server using dynamic imports to avoid ESM resolution friction at build time.
export async function startMcpServer() {
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    // Create server
    // @ts-ignore - runtime ESM types
    const server = new Server({ name: "@nock/mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
    // @ts-ignore
    server.tool("check_before_apply", {
        inputSchema: {
            type: "object",
            required: ["sql"],
            properties: {
                sql: { type: "string" },
                pgVersion: { type: "string" },
                statsPath: { type: "string" },
                policyPath: { type: "string" }
            }
        }
    }, async (args) => {
        const sql = String(args.sql);
        const stats = args.statsPath
            ? JSON.parse(fs.readFileSync(String(args.statsPath), "utf8"))
            : { tables: [] };
        const policy = args.policyPath
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
        const verdict = check({
            sql,
            stats,
            policy,
            pgVersion: args.pgVersion ? String(args.pgVersion) : undefined
        });
        return { content: [{ type: "json", json: verdict }] };
    });
    // @ts-ignore
    server.tool("list_rules", { inputSchema: { type: "object", properties: {} } }, async () => {
        return {
            content: [
                {
                    type: "json",
                    json: [
                        { id: "R001", title: "Non-concurrent CREATE INDEX", default: { red_rows: 10000 } },
                        { id: "R010", title: "Require lock_timeout on hot tables", default: { rows: 1000000 } }
                    ]
                }
            ]
        };
    });
    // @ts-ignore
    server.tool("explain_lock", {
        inputSchema: {
            type: "object",
            required: ["sql"],
            properties: { sql: { type: "string" } }
        }
    }, async (args) => {
        const sql = String(args.sql);
        const up = sql.trim().toUpperCase();
        let lock = "UNKNOWN";
        if (up.startsWith("CREATE INDEX") && !up.includes(" CONCURRENTLY "))
            lock = "SHARE";
        else if (up.includes(" CONCURRENTLY "))
            lock = "SHARE UPDATE EXCLUSIVE";
        return { content: [{ type: "text", text: `Lock mode: ${lock}` }] };
    });
    // @ts-ignore
    const transport = new StdioServerTransport();
    // @ts-ignore
    await server.connect(transport);
}
// If launched as a standalone process, start the server
if (process.argv[1] && process.argv[1].endsWith("index.js")) {
    startMcpServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
export function checkBeforeApplyLocal(args) {
    const stats = args.statsPath
        ? JSON.parse(fs.readFileSync(String(args.statsPath), "utf8"))
        : { tables: [] };
    const policy = args.policyPath
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
    return check({ sql: args.sql, stats, policy, pgVersion: args.pgVersion });
}
//# sourceMappingURL=index.js.map