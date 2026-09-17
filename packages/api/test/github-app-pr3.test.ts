import { describe, it, expect, beforeEach } from "vitest";
import { buildPrCommentBodyFromVerdict, postFailOnlyPrCommentIfNeeded, PR_COMMENT_MARKER } from "../src/github_app";
import type { VerdictV1 } from "@nockhq/core";

function makeVerdict(violations: Array<{ rule_id: string; severity: "red" | "yellow"; message: string; remediation_sql?: string }>): VerdictV1 {
  return {
    schema_version: "1",
    verdict: violations.some((v) => v.severity === "red") ? "fail" : "pass",
    statements: [],
    violations,
    meta: { policy_id: "nock.postgres.ddl.default", engine: "postgres", estate_captured_at: "2026-09-16T05:00:00Z" },
  };
}

describe("PR3 — PR comment renderer", () => {
  it("renders header, marker, counts, and remediation SQL", () => {
    const v = makeVerdict([
      { rule_id: "R012", severity: "red", message: "VACUUM FULL on large table", remediation_sql: "VACUUM (FULL, PARALLEL 4) small_table;" },
      { rule_id: "R016", severity: "yellow", message: "Potential lock risk" },
    ]);
    const body = buildPrCommentBodyFromVerdict(v);
    expect(body).toContain(PR_COMMENT_MARKER);
    expect(body).toContain("**Nock: DDL gate**");
    expect(body).toContain("FAIL — red=1, yellow=1");
    expect(body).toContain("```sql");
    expect(body).toContain("VACUUM (FULL, PARALLEL 4) small_table;");
  });
});

describe("PR3 — fail-only PR comment gating", () => {
  const owner = "o";
  const repo = "r";
  const pullNumber = 1;
  const installationToken = "t";
  const apiBase = "https://api.github.com";

  beforeEach(() => {
    // reset fetch between tests
    // @ts-ignore
    global.fetch = undefined as any;
  });

  it("posts a comment when verdict has reds", async () => {
    const v = makeVerdict([{ rule_id: "R012", severity: "red", message: "bad" }]);
    const calls: string[] = [];
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      calls.push(`${init?.method || "GET"} ${u}`);
      if (u.startsWith(`${apiBase}/repos/${owner}/${repo}/issues/${pullNumber}/comments?`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (u.startsWith(`${apiBase}/repos/${owner}/${repo}/issues/${pullNumber}/comments`) && (init?.method || "GET") === "POST") {
        return new Response(JSON.stringify({ id: 999 }), { status: 201 });
      }
      return new Response("", { status: 404 });
    };
    await postFailOnlyPrCommentIfNeeded({ owner, repo, pullNumber, installationToken, verdict: v, apiBase });
    expect(calls.some((c) => c.startsWith("POST"))).toBe(true);
  });

  it("patches existing comment when marker is present", async () => {
    const v = makeVerdict([{ rule_id: "R012", severity: "red", message: "bad" }]);
    const calls: string[] = [];
    (global as any).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const u = typeof input === "string" ? input : input.toString();
      calls.push(`${init?.method || "GET"} ${u}`);
      if (u.startsWith(`${apiBase}/repos/${owner}/${repo}/issues/${pullNumber}/comments?`)) {
        return new Response(JSON.stringify([{ id: 123, body: `${PR_COMMENT_MARKER}\nold` }]), { status: 200 });
      }
      if (u.startsWith(`${apiBase}/repos/${owner}/${repo}/issues/comments/123`) && (init?.method || "GET") === "PATCH") {
        return new Response(JSON.stringify({ id: 123 }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    await postFailOnlyPrCommentIfNeeded({ owner, repo, pullNumber, installationToken, verdict: v, apiBase });
    expect(calls.some((c) => c.startsWith("PATCH"))).toBe(true);
  });

  it("does nothing when verdict has no reds", async () => {
    const v = makeVerdict([{ rule_id: "R016", severity: "yellow", message: "warn" }]);
    let called = false;
    (global as any).fetch = async (): Promise<Response> => {
      called = true;
      return new Response("", { status: 500 });
    };
    await postFailOnlyPrCommentIfNeeded({ owner, repo, pullNumber, installationToken, verdict: v, apiBase });
    expect(called).toBe(false);
  });
});

