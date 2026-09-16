import { describe, it, beforeEach, expect } from "vitest";
import { createApp } from "../src/server";

describe("Policy + Audit API (in-memory store, local server)", () => {
  beforeEach(() => {
    process.env.NOCK_ESTATE_API_TOKEN = "t";
    delete (globalThis as any).__nockInMemPolicyAudit;
  });

  it("PUTs org default policy and falls back on GET", async () => {
    const app = createApp();
    // Initially 404
    let res = await app.request("/v1/policy/acme/api", { headers: { authorization: "Bearer t" } });
    expect(res.status).toBe(404);
    // Put org default (scope: org)
    const pack = {
      id: "nock.pack.org.acme",
      version: "2026.09.01",
      fail_on: "red",
      rules: { R001: { red_rows: 5000 } },
    };
    res = await app.request("/v1/policy/acme", {
      method: "PUT",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
        "x-nock-org-id": "acme",
        "x-nock-policy-scope": "org",
      },
      body: JSON.stringify(pack),
    });
    expect(res.status).toBe(200);
    const putJson = await res.json();
    expect(putJson.version).toBe(1);
    // GET for repo without repo-level policy → falls back to org default
    res = await app.request(`/v1/policy/${encodeURIComponent("acme/api")}`, { headers: { authorization: "Bearer t" } });
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
    let res = await app.request("/v1/audit", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    res = await app.request(`/v1/audit/${encodeURIComponent("acme/api")}?limit=10`, {
      headers: { authorization: "Bearer t" },
    });
    expect(res.status).toBe(200);
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].repo_id).toBe("acme/api");
    expect(events[0].rule_ids).toEqual(["R001", "R010"]);
  });
});

