import { describe, it, beforeEach, expect } from "vitest";
import { createApp } from "../src/server";
import { LocalFileStatsStore } from "../src/store";
import { envelopeEncrypt } from "@nockhq/secure-estate";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const sampleEstate = {
  schema_version: "1",
  captured_at: "2026-09-16T05:00:00Z",
  pg_version: "16.4",
  source: "sync-estate",
  tables: [{ schema: "public", name: "t", n_live_tup: 1, n_dead_tup: 0, relation_bytes: 10, total_bytes: 20, last_analyze: null, last_autoanalyze: null }],
};

class FakeStmt {
  private params: any[] = [];
  private rowsByHash: Map<string, { org_id: string; revoked?: boolean }>;
  constructor(private sql: string, rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {
    this.rowsByHash = rowsByHash;
  }
  bind(...args: any[]) {
    this.params = args;
    return this;
  }
  async first(): Promise<any | null> {
    const h = String(this.params[0] || "");
    const rec = this.rowsByHash.get(h);
    if (!rec) return null;
    if (rec.revoked) return null;
    return { org_id: rec.org_id };
  }
  async run(): Promise<any> {
    return { success: true, meta: { changes: 1 } };
  }
  async all(): Promise<any> {
    return { results: [] };
  }
}
class FakeD1 {
  constructor(private rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {}
  prepare(sql: string) {
    return new FakeStmt(sql, this.rowsByHash);
  }
}
function sha256Hex(s: string): string {
  const h = crypto.createHash("sha256");
  h.update(s, "utf8");
  return h.digest("hex");
}

describe("Export routes (PR2)", () => {
  let dir: string;
  let kek: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_ESTATE_STORE_DIR = dir;
    process.env.NOCK_ESTATE_API_TOKEN = "t";
    kek = Buffer.alloc(32, 7).toString("base64");
    process.env.NOCK_ESTATE_KEK = kek;
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("exports estate as envelope by default and plaintext when requested", async () => {
    const s = new LocalFileStatsStore(dir);
    const env = envelopeEncrypt(sampleEstate as any, kek);
    await s.saveEnvelope("acme/api", env);
    const app = createApp();
    // Default -> envelope
    let res = await app.request(`/v1/export/estate/${encodeURIComponent("acme/api")}`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const gotEnv = await res.json();
    expect(gotEnv.version).toBe("v1");
    // plaintext -> decrypted JSON
    res = await app.request(`/v1/export/estate/${encodeURIComponent("acme/api")}?format=plaintext`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const gotPt = await res.json();
    expect(gotPt.pg_version).toBe(sampleEstate.pg_version);
  });

  it("returns 401 when missing auth", async () => {
    const app = createApp();
    const res = await app.request(`/v1/export/estate/${encodeURIComponent("acme/api")}`);
    expect(res.status).toBe(401);
  });

  it("returns 404 when estate not found", async () => {
    const app = createApp();
    const res = await app.request(`/v1/export/estate/${encodeURIComponent("acme/unknown")}`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(404);
  });

  it("exports audit as NDJSON by default and JSON array when requested", async () => {
    const app = createApp();
    // Append an audit row
    const body = {
      org_id: "acme",
      repo_id: "acme/api",
      sql_hash: "sha256:feedface",
      verdict: "fail",
      rule_ids: ["R001"],
      estate_captured_at: "2026-09-10T12:00:00Z",
      freshness: "stale",
      rule_hits: [{ id: "R001", severity: "red", table: "users", n_live_tup: 10, reason_code: "NLT_GT_5" }],
    };
    let res = await app.request("/v1/audit", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    // NDJSON default
    res = await app.request(`/v1/export/audit/${encodeURIComponent("acme/api")}`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toMatch(/ndjson/i);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const row = JSON.parse(lines[0]);
    expect(row.repo_id).toBe("acme/api");
    expect(Array.isArray(row.rule_hits)).toBe(true);
    // JSON array
    res = await app.request(`/v1/export/audit/${encodeURIComponent("acme/api")}?format=json`, {
      headers: { authorization: "Bearer t" },
    });
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr[0].sql_hash).toBe("sha256:feedface");
  });

  it("enforces org scoping when token has orgId (no cross-org leakage)", async () => {
    // Disable env bearer for this test; use hashed token with org_id=acme
    delete process.env.NOCK_ESTATE_API_TOKEN;
    const token = "sekret";
    const hash = sha256Hex(token);
    const envBindings = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) } as any;
    // Prepare estate under acme/api
    const s = new LocalFileStatsStore(dir);
    const env = envelopeEncrypt(sampleEstate as any, kek);
    await s.saveEnvelope("acme/api", env);
    const app = createApp();
    // Request with matching owner -> 200
    let req = new Request(`http://localhost/v1/export/estate/${encodeURIComponent("acme/api")}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    let res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    // Request other owner -> 404 (not found)
    req = new Request(`http://localhost/v1/export/estate/${encodeURIComponent("other/api")}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(404);
    // Request bare repo resolves using org scope -> 200 for "api" (resolves to acme/api)
    req = new Request(`http://localhost/v1/export/estate/api`, {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
  });
});

