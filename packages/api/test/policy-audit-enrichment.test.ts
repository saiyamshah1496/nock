import { describe, it, beforeEach, expect } from "vitest";
import { createApp } from "../src/server";
import crypto from "crypto";
 
class FakeStmt {
  private params: any[] = [];
  constructor(private _sql: string, private rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {}
  bind(...args: any[]) {
    this.params = args;
    return this;
  }
  async first(): Promise<any | null> {
    const h = String(this.params[0] || "");
    const rec = this.rowsByHash.get(h);
    if (!rec || rec.revoked) return null;
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

describe("Policy Audit enrichment fields", () => {
  beforeEach(() => {
    delete process.env.NOCK_ESTATE_API_TOKEN;
    delete process.env.NOCK_TEAM_API_TOKEN;
    delete process.env.NOCK_STATS_API_TOKEN;
    delete process.env.NOCK_ALLOW_ENV_BEARER;
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("accepts and returns optional estate_captured_at, freshness, rule_hits", async () => {
    const token = "sekret";
    const hash = sha256Hex(token);
    const env = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) };
    const app = createApp();
    const body = {
      org_id: "acme",
      repo_id: "acme/api",
      sql_hash: "sha256:cafebabe",
      verdict: "pass",
      rule_ids: ["R001"],
      estate_captured_at: "2026-09-10T12:00:00Z",
      freshness: "warn",
      rule_hits: [{ id: "R001", severity: "red", table: "users", n_live_tup: 1234, reason_code: "NLT_GT_1000" }],
    };
    let req = new Request("http://localhost/v1/audit", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let res = await (app as any).fetch(req, env);
    expect(res.status).toBe(200);
    req = new Request("http://localhost/v1/audit/acme/api?limit=5", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, env);
    expect(res.status).toBe(200);
    const events = await res.json();
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev.freshness).toBe("warn");
    expect(ev.estate_captured_at).toBe("2026-09-10T12:00:00Z");
    expect(Array.isArray(ev.rule_hits)).toBe(true);
    expect(ev.rule_hits[0].id).toBe("R001");
    expect(ev.rule_hits[0].n_live_tup).toBe(1234);
  });
});

