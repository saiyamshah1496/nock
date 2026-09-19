import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { join } from "path";
import { readFileSync } from "fs";
import { checkBeforeApplyHostedOrLocal } from "../src/index.js";
import { check, type EstateSnapshot, type PolicyResolved } from "@nockhq/core";

describe("Hosted golden parity — MCP helper JSON ≡ CLI JSON", () => {
  let srv: Server;
  let base: string;
  beforeAll(async () => {
    srv = createServer((req, res) => {
      // Minimal mock API
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

  it("same SQL + same hosted estate → identical verdict projection", async () => {
    const sqlPath = join(__dirname, "../../../fixtures/create_index_nonconcurrent.sql");
    const localEstate = join(__dirname, "../../../fixtures/estate_billion.json"); // fallback only; not used in hosted pass
    // Reference verdict via shared engine using the same hosted estate+policy
    const hostedEstate = (await (await fetch(`${base}/v1/estate/o/r`, { headers: { Authorization: "Bearer t", Accept: "application/json" } })).json()) as EstateSnapshot;
    const hostedPolicy = (await (await fetch(`${base}/v1/policy/o/r`, { headers: { Authorization: "Bearer t", Accept: "application/json" } })).json()) as PolicyResolved;
    const refVerdict = check({
      sql: readFileSync(sqlPath, "utf8"),
      estate: hostedEstate,
      policy: hostedPolicy,
    });

    const verdict = await checkBeforeApplyHostedOrLocal({
      sql: readFileSync(sqlPath, "utf8"),
      estatePath: localEstate,
      estateApiUrl: `${base}/v1/estate/o/r`,
      estateApiToken: "t",
      apiBaseUrl: base,
    });

    // Project comparable fields: outcome and rule ids (order-insensitive)
    expect(refVerdict.verdict).toEqual(verdict.verdict);
    expect(refVerdict.violations.map((v: any) => v.rule_id).sort()).toEqual(
      verdict.violations.map((v) => v.rule_id).sort()
    );
  });
});

