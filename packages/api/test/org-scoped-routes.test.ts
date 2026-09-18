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
  constructor(private _sql: string, rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {
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

describe("Org-scoped tokens: consistent keying across POST/GET/export", () => {
  let dir: string;
  let kek: string;
  let token: string;
  let envBindings: any;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_ESTATE_STORE_DIR = dir;
    delete process.env.NOCK_ESTATE_API_TOKEN;
    delete process.env.NOCK_TEAM_API_TOKEN;
    delete process.env.NOCK_STATS_API_TOKEN;
    kek = Buffer.alloc(32, 7).toString("base64");
    process.env.NOCK_ESTATE_KEK = kek;
    token = "sekret";
    const hash = sha256Hex(token);
    envBindings = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) } as any;
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("POST estate with org token stores acme/api; GET + export succeed via owner/repo path", async () => {
    const app = createApp();
    const fresh = { ...sampleEstate, captured_at: new Date().toISOString() };
    const env = envelopeEncrypt(fresh as any, kek);
    // POST owner/repo using org-scoped token
    let req = new Request("http://localhost/v1/estate/acme/api", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(env),
    });
    let res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    // GET estate plaintext with same owner/repo (authorized) -> 200
    req = new Request("http://localhost/v1/estate/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const snap = await res.json();
    expect(snap.pg_version).toBe(sampleEstate.pg_version);
    // Export estate (envelope)
    req = new Request("http://localhost/v1/export/estate/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const gotEnv = await res.json();
    expect(gotEnv.version).toBe("v1");
    // Export estate plaintext
    req = new Request("http://localhost/v1/export/estate/acme/api?format=plaintext", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const gotPt = await res.json();
    expect(gotPt.pg_version).toBe(sampleEstate.pg_version);
  });

  it("Audit list/export honor org scoping for owner/repo path", async () => {
    const app = createApp();
    // Append an audit row (as produced by engine) for scoped id
    let req = new Request("http://localhost/v1/audit", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        org_id: "acme",
        repo_id: "acme/api",
        sql_hash: "sha256:c0ffee",
        verdict: "fail",
        rule_ids: ["R001"],
      }),
    });
    let res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    // List with owner/repo under org token -> finds row
    req = new Request("http://localhost/v1/audit/acme/api?limit=5", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(1);
    expect(arr[0].repo_id).toBe("acme/api");
    // Export audit also finds row
    req = new Request("http://localhost/v1/export/audit/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes("\"repo_id\":\"acme/api\"")).toBe(true);
  });
});

