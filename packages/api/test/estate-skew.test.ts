import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/server";
import { envelopeEncrypt } from "@nockhq/secure-estate";
import fs from "fs";
import os from "os";
import path from "path";
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

const makeSnapshot = (capturedAtIso: string) => ({
  schema_version: "1",
  captured_at: capturedAtIso,
  pg_version: "16.4",
  source: "sync-estate",
  tables: [],
});

describe("POST /v1/estate/:owner/:repo skew validation", () => {
  let token: string;
  let envBindings: any;
  beforeEach(() => {
    delete process.env.NOCK_ESTATE_API_TOKEN;
    delete process.env.NOCK_TEAM_API_TOKEN;
    delete process.env.NOCK_STATS_API_TOKEN;
    delete process.env.NOCK_ALLOW_ENV_BEARER;
    process.env.NOCK_ESTATE_KEK = Buffer.alloc(32, 7).toString("base64");
    delete process.env.NOCK_DEV_PLAINTEXT_ESTATE;
    // Isolate store to a temp dir to avoid polluting repo
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nock-api-test-"));
    process.env.NOCK_ESTATE_STORE_DIR = dir;
    token = "sekret";
    const hash = sha256Hex(token);
    envBindings = { NOCK_D1: new FakeD1(new Map([[hash, { org_id: "acme" }]])) } as any;
  });

  it("accepts envelope when captured_at within 1 hour", async () => {
    const app = createApp();
    const now = Date.now();
    const okSnap = makeSnapshot(new Date(now - 30 * 60 * 1000).toISOString()); // 30m ago
    const env = envelopeEncrypt(okSnap as any, String(process.env.NOCK_ESTATE_KEK));
    const req = new Request("http://localhost/v1/estate/acme/repo1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env),
    });
    const res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(200);
  });

  it("rejects envelope when captured_at skew exceeds 1 hour", async () => {
    const app = createApp();
    const now = Date.now();
    const badSnap = makeSnapshot(new Date(now - 2 * 60 * 60 * 1000).toISOString()); // 2h ago
    const env = envelopeEncrypt(badSnap as any, String(process.env.NOCK_ESTATE_KEK));
    const req = new Request("http://localhost/v1/estate/acme/repo2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env),
    });
    const res = await (app as any).fetch(req, envBindings);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error || "").toMatch(/skew/i);
  });
});

