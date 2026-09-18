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

describe("Policy + Audit API (in-memory store, local server)", () => {
  let token: string;
  let envBindings: any;
  beforeEach(() => {
    delete process.env.NOCK_ESTATE_API_TOKEN;
    delete process.env.NOCK_TEAM_API_TOKEN;
    delete process.env.NOCK_STATS_API_TOKEN;
    delete process.env.NOCK_ALLOW_ENV_BEARER;
    token = "sekret";
    const hash = sha256Hex(token);
    envBindings = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) } as any;
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("PUTs org default policy and falls back on GET", async () => {
    const app = createApp();
    // Initially 404
    let req = new Request("http://localhost/v1/policy/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    let res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(404);
    // Put org default (scope: org)
    const pack = {
      id: "nock.pack.org.acme",
      version: "2026.09.01",
      fail_on: "red",
      rules: { R001: { red_rows: 5000 } },
    };
    req = new Request("http://localhost/v1/policy/acme", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-nock-org-id": "acme",
        "x-nock-policy-scope": "org",
      },
      body: JSON.stringify(pack),
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const putJson = await res.json();
    expect(putJson.version).toBe(1);
    // GET for repo without repo-level policy → falls back to org default
    req = new Request("http://localhost/v1/policy/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const got = await res.json();
    expect(got.id).toBe(pack.id);
    expect(got.rules.R001.red_rows).toBe(5000);
  });

  it("Appends audit events and lists recent", async () => {
    const app = createApp();
    const body = {
      org_id: "acme",
      repo_id: "acme/api",
      sql_hash: "sha256:deadbeef",
      verdict: "fail",
      rule_ids: ["R001", "R010"],
      policy_version: 1,
      actor: "octocat",
      ci_run_id: "12345",
    };
    let req = new Request("http://localhost/v1/audit", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    req = new Request("http://localhost/v1/audit/acme/api?limit=10", {
      headers: { authorization: `Bearer ${token}` },
    });
    res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].repo_id).toBe("acme/api");
    expect(events[0].rule_ids).toEqual(["R001", "R010"]);
  });
});

