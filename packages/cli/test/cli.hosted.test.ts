import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { join } from "path";

function runCli(args: string[], env?: Record<string, string>) {
  const bin = join(__dirname, "../dist/bin/nock.js");
  const res = spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

describe("CLI — prefer hosted estate+policy when configured; fallback otherwise", () => {
  let srv: Server;
  let base: string;
  beforeAll(async () => {
    srv = createServer((req, res) => {
      // Simple router
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

  it.skip("uses hosted estate when url+token present", () => {
    const sql = join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql");
    const localEstate = join(__dirname, "../../../fixtures/estate_billion.json"); // would be RED if used
    const res = runCli(
      [
        "check",
        "--sql",
        sql,
        "--estate",
        localEstate,
        "--estate-api-url",
        `${base}/v1/estate/o/r`,
        "--estate-api-token",
        "t",
        "--api-base-url",
        base,
        "--format",
        "json",
      ],
      {}
    );
    const j = JSON.parse(res.stdout);
    expect(j.verdict).toBe("pass"); // hosted small estate neutralizes R001 red
  });

  it("falls back to local when no token provided", () => {
    const sql = join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql");
    const localEstate = join(__dirname, "../../../fixtures/estate_billion.json");
    const res = runCli(
      [
        "check",
        "--sql",
        sql,
        "--estate",
        localEstate,
        "--estate-api-url",
        `${base}/v1/estate/o/r`,
        "--format",
        "json",
      ],
      {} // no token env
    );
    const j = JSON.parse(res.stdout);
    expect(j.verdict).toBe("fail"); // uses local large estate
  });
});

