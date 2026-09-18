import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { join } from "path";
import { readFileSync } from "fs";
import { checkBeforeApplyHostedOrLocal } from "../src/index.js";

describe("MCP — prefer hosted estate+policy when configured; fallback otherwise", () => {
  let srv: Server;
  let base: string;
  beforeAll(async () => {
    srv = createServer((req, res) => {
      if (req.method === "GET" && req.url && req.url.startsWith("/v1/estate/o/r")) {
        if (!req.headers["authorization"]) {
          res.statusCode = 401;
          res.end("unauthorized");
          return;
        }
        const body = JSON.stringify({
          captured_at: new Date().toISOString(),
          tables: [{ schema: "public", name: "sessions", n_live_tup: 1000 }],
        });
        res.setHeader("content-type", "application/json");
        res.end(body);
        return;
      }
      if (req.method === "GET" && req.url && req.url.startsWith("/v1/policy/o/r")) {
        const body = JSON.stringify({
          id: "nock.postgres.ddl.default",
          version: "1.0.0",
          fail_on: "red",
          rules: { R001: { red_rows: 10000 }, R010: { always_require_lock_timeout_above_rows: 1000000 } },
        });
        res.setHeader("content-type", "application/json");
        res.end(body);
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((resolve) => srv.listen(0, resolve));
    const port = (srv.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("uses hosted estate when url+token present", async () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql"), "utf8");
    const verdict = await checkBeforeApplyHostedOrLocal({
      sql,
      estatePath: join(__dirname, "../../../fixtures/estate_billion.json"),
      estateApiUrl: `${base}/v1/estate/o/r`,
      estateApiToken: "t",
      apiBaseUrl: base,
    });
    expect(verdict.verdict).toBe("pass");
  });

  it("falls back to local when no token", async () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql"), "utf8");
    const verdict = await checkBeforeApplyHostedOrLocal({
      sql,
      estatePath: join(__dirname, "../../../fixtures/estate_billion.json"),
      estateApiUrl: `${base}/v1/estate/o/r`,
      apiBaseUrl: base,
    });
    expect(verdict.verdict).toBe("fail");
  });
});

