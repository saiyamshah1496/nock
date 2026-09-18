import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveEstate, resolvePolicy } from "../src/github_app";

describe("PR3 — App prefers hosted estate+policy via token when configured", () => {
  const owner = "o";
  const repo = "r";
  const headRef = "head";
  const baseRef = "base";
  const apiBase = "https://internal.nock";

  beforeEach(() => {
    process.env.NOCK_APP_BASE_URL = apiBase;
    process.env.NOCK_TEAM_API_TOKEN = "t";
  });
  afterEach(() => {
    delete process.env.NOCK_APP_BASE_URL;
    delete process.env.NOCK_TEAM_API_TOKEN;
    // @ts-ignore
    global.fetch = undefined as any;
  });

  it("resolveEstate returns hosted snapshot when available", async () => {
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.startsWith(`${apiBase}/v1/estate/${encodeURIComponent(`${owner}/${repo}`)}`)) {
        if (!init?.headers || !(init.headers as any)["Authorization"]) {
          return new Response("unauthorized", { status: 401 });
        }
        const body = JSON.stringify({
          captured_at: new Date().toISOString(),
          tables: [{ schema: "public", name: "sessions", n_live_tup: 1000 }],
        });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 404 });
    };
    const estate = await resolveEstate(
      { installationToken: "x", owner, repo, headRef, baseRef, apiBase: "https://api.github.com" },
      apiBase,
      "t"
    );
    expect(estate && Array.isArray(estate.tables)).toBe(true);
  });

  it("resolvePolicy returns hosted policy when available", async () => {
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.startsWith(`${apiBase}/v1/policy/${encodeURIComponent(`${owner}/${repo}`)}`)) {
        if (!init?.headers || !(init.headers as any)["Authorization"]) {
          return new Response("unauthorized", { status: 401 });
        }
        const body = JSON.stringify({
          id: "nock.postgres.ddl.default",
          version: "1.0.0",
          fail_on: "red",
          rules: {},
        });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("", { status: 404 });
    };
    const policy = await resolvePolicy(
      { installationToken: "x", owner, repo, headRef, baseRef, apiBase: "https://api.github.com" },
      apiBase,
      "t"
    );
    expect((policy as any).id).toBe("nock.postgres.ddl.default");
  });
});

