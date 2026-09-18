import { describe, it, beforeEach, expect } from "vitest";
import { createApp } from "../src/server";

describe("Policy Audit enrichment fields", () => {
  beforeEach(() => {
    process.env.NOCK_ESTATE_API_TOKEN = "t";
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("accepts and returns optional estate_captured_at, freshness, rule_hits", async () => {
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
    let res = await app.request("/v1/audit", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    res = await app.request(`/v1/audit/acme/api?limit=5`, {
      headers: { authorization: "Bearer t" },
    });
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

