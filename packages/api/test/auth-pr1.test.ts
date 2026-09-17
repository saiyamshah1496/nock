import { describe, it, beforeEach, expect } from "vitest";
import { createApp } from "../src/server";
import crypto from "crypto";

class FakeStmt {
  private sql: string;
  private params: any[] = [];
  private rowsByHash: Map<string, { org_id: string; revoked?: boolean }>;
  constructor(sql: string, rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {
    this.sql = sql;
    this.rowsByHash = rowsByHash;
  }
  bind(...args: any[]) {
    this.params = args;
    return this;
  }
  async first(): Promise<any | null> {
    // SELECT ... FROM tokens WHERE token_hash = ?1 AND revoked_at IS NULL
    const h = String(this.params[0] || "");
    const rec = this.rowsByHash.get(h);
    if (!rec) return null;
    if (rec.revoked) return null;
    return { org_id: rec.org_id };
  }
  async run(): Promise<any> {
    // UPDATE tokens SET last_used_at...
    return { success: true, meta: { changes: 1 } };
  }
  async all(): Promise<any> {
    return { results: [] };
  }
}

class FakeD1 {
  private rowsByHash: Map<string, { org_id: string; revoked?: boolean }>;
  constructor(rowsByHash: Map<string, { org_id: string; revoked?: boolean }>) {
    this.rowsByHash = rowsByHash;
  }
  prepare(sql: string) {
    return new FakeStmt(sql, this.rowsByHash);
  }
}

function sha256Hex(s: string): string {
  const h = crypto.createHash("sha256");
  h.update(s, "utf8");
  return h.digest("hex");
}

describe("Auth PR1: hashed tokens + env fallback", () => {
  beforeEach(() => {
    delete process.env.NOCK_TEAM_API_TOKEN;
    delete process.env.NOCK_ESTATE_API_TOKEN;
    delete process.env.NOCK_STATS_API_TOKEN;
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("accepts when token hash matches a non-revoked token", async () => {
    const token = "sekret";
    const hash = sha256Hex(token);
    const env = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) };
    const app = createApp();
    const req = new Request("http://localhost/v1/policy/acme", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-nock-org-id": "acme",
        "x-nock-policy-scope": "org",
      },
      body: JSON.stringify({
        id: "nock.test",
        version: "1.0.0",
        fail_on: "red",
        rules: { R001: { red_rows: 1000 } },
      }),
    });
    const res = await (app as any).fetch(req, env);
    expect(res.status).toBe(200);
  });

  it("rejects when token is revoked (or missing in table)", async () => {
    const token = "revoked";
    const hash = sha256Hex(token);
    // Present in table but marked revoked -> SELECT should not return
    const env = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme", revoked: true }]])) };
    const app = createApp();
    const req = new Request("http://localhost/v1/policy/acme/api", {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await (app as any).fetch(req, env);
    expect(res.status).toBe(401);
  });

  it("falls back to env bearer when NOCK_TEAM_API_TOKEN matches", async () => {
    process.env.NOCK_TEAM_API_TOKEN = "partner-token";
    const app = createApp();
    const res = await app.request("/v1/policy/acme/api", {
      headers: { authorization: "Bearer partner-token" },
    });
    // No policy present -> 404, meaning auth succeeded
    expect(res.status).toBe(404);
  });

  it("returns 401 when token missing and auth is configured", async () => {
    process.env.NOCK_TEAM_API_TOKEN = "x";
    const app = createApp();
    const res = await app.request("/v1/policy/acme/api");
    expect(res.status).toBe(401);
  });
});

