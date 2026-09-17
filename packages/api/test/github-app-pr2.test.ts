import { describe, it, expect } from "vitest";
import { mapVerdictToConclusion, resolveEstate } from "../src/github_app";
import { check, type VerdictV1, type EstateSnapshot, type PolicyResolved } from "@nockhq/core";
import { readFileSync } from "fs";
import { join } from "path";
import YAML from "yaml";

describe("PR2 — verdict mapping", () => {
  it("maps red to failure", () => {
    const v: VerdictV1 = {
      schema_version: "1",
      verdict: "fail",
      statements: [],
      violations: [{ rule_id: "R012", severity: "red", message: "VACUUM FULL" }],
      meta: { policy_id: "nock.postgres.ddl.default", engine: "postgres" },
    };
    expect(mapVerdictToConclusion(v).conclusion).toBe("failure");
  });

  it("maps yellow-only to neutral", () => {
    const v: VerdictV1 = {
      schema_version: "1",
      verdict: "pass",
      statements: [],
      violations: [{ rule_id: "R016", severity: "yellow", message: "Potential lock risk" }],
      meta: { policy_id: "nock.postgres.ddl.default", engine: "postgres" },
    };
    expect(mapVerdictToConclusion(v).conclusion).toBe("neutral");
  });

  it("maps no violations to success", () => {
    const v: VerdictV1 = {
      schema_version: "1",
      verdict: "pass",
      statements: [],
      violations: [],
      meta: { policy_id: "nock.postgres.ddl.default", engine: "postgres" },
    };
    expect(mapVerdictToConclusion(v).conclusion).toBe("success");
  });
});

describe("PR2 — core check integration on fixtures (red/green)", () => {
  const estateHuge: EstateSnapshot = JSON.parse(
    readFileSync(join(__dirname, "../../../fixtures/estate_billion.json"), "utf8")
  );
  const policy: PolicyResolved = YAML.parse(
    readFileSync(join(__dirname, "../../../policy.default.yml"), "utf8")
  ) as PolicyResolved;

  it("flags VACUUM FULL as failure (red)", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/vacuum_full.sql"), "utf8");
    const v = check({ sql, estate: estateHuge, policy });
    expect(mapVerdictToConclusion(v).conclusion).toBe("failure");
  });

  it("warns (neutral) on ATTACH PARTITION", () => {
    const sql = readFileSync(join(__dirname, "../../../fixtures/attach_partition.sql"), "utf8");
    const v = check({ sql, estate: estateHuge, policy });
    expect(mapVerdictToConclusion(v).conclusion).toBe("neutral");
  });
});

describe("PR2 — estate resolution order", () => {
  const apiBase = "https://api.github.com";
  const installToken = "token";
  const owner = "o";
  const repo = "r";
  const headRef = "headsha";
  const baseRef = "basesha";

  function mockContents(path: string, ref: string, content: string | null) {
    const encoded = content == null ? null : Buffer.from(content, "utf8").toString("base64");
    const url = `${apiBase}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      // Return 404 for unrelated or missing
      if (u !== url) return new Response("", { status: 404 });
      if (content == null) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ content: encoded }), { status: 200 });
    };
  }

  it("prefers .nock/estate.json on head", async () => {
    mockContents(".nock/estate.json", headRef, JSON.stringify({ tables: [] }));
    const estate = await resolveEstate({ installationToken: installToken, owner, repo, headRef, baseRef, apiBase });
    expect(estate && Array.isArray(estate.tables)).toBe(true);
  });

  it("falls back to base when head missing", async () => {
    // head 404, base has it
    (global as any).fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes(encodeURIComponent(".nock/estate.json")) && u.includes(encodeURIComponent(headRef))) {
        return new Response("", { status: 404 });
      }
      if (u.includes(encodeURIComponent(".nock/estate.json")) && u.includes(encodeURIComponent(baseRef))) {
        const encoded = Buffer.from(JSON.stringify({ tables: [] }), "utf8").toString("base64");
        return new Response(JSON.stringify({ content: encoded }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const estate = await resolveEstate({ installationToken: installToken, owner, repo, headRef, baseRef, apiBase });
    expect(estate && Array.isArray(estate.tables)).toBe(true);
  });

  it("supports redirect via nock.yml estate-path", async () => {
    (global as any).fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      const isConfig = u.includes(encodeURIComponent("nock.yml"));
      const isEstate = u.includes(encodeURIComponent("config/estate.json"));
      if (isConfig) {
        const encoded = Buffer.from(YAML.stringify({ "estate-path": "config/estate.json" }), "utf8").toString("base64");
        return new Response(JSON.stringify({ content: encoded }), { status: 200 });
      }
      if (isEstate) {
        const encoded = Buffer.from(JSON.stringify({ tables: [] }), "utf8").toString("base64");
        return new Response(JSON.stringify({ content: encoded }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const estate = await resolveEstate({ installationToken: installToken, owner, repo, headRef, baseRef, apiBase });
    expect(estate && Array.isArray(estate.tables)).toBe(true);
  });
});

