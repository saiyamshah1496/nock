import { Hono } from "hono";
import type { EstateStore } from "./store";
import type { EstateSnapshot } from "@nock/core";
import { envelopeDecryptToSnapshot, type EnvelopeV1 } from "@nock/secure-estate";
import {
  InMemoryPolicyAuditStore,
  type PolicyAuditStore,
  type PolicyAuditStoreFactory,
  type PolicyPack,
} from "./policy_audit_store";

function requireToken(c: any): string | null {
  const header = c.req.header("authorization") || c.req.header("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}

function okJson(c: any, body: any, status = 200) {
  return c.json(body, status);
}
function errJson(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

function requireAuth(c: any): string | null {
  const token = requireToken(c);
  const expected = process.env.NOCK_ESTATE_API_TOKEN || process.env.NOCK_STATS_API_TOKEN || "";
  if (!expected) return "__MISSING_CONFIG__";
  if (!token || token !== expected) return null;
  return token;
}

function parseOrgRepo(repoId: string, orgIdHeader?: string | null): { orgId?: string; repoId: string } {
  if (repoId.includes("/")) {
    const [orgId] = repoId.split("/", 1);
    return { orgId, repoId };
  }
  const orgId = orgIdHeader || undefined;
  return { orgId, repoId };
}

export function createApp(
  statsStore: EstateStore,
  policyAuditFactory?: PolicyAuditStoreFactory
) {
  const app = new Hono();
  // Health
  app.get("/healthz", (c) => c.text("ok"));
  // POST /v1/estate/:repoId
  app.post("/v1/estate/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    const auth = requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_ESTATE === "1" || process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    try {
      const body = await c.req.json();
      if (isDevPlain) {
        const snapshot = body as EstateSnapshot;
        await statsStore.savePlaintext(repoId, snapshot);
        return okJson(c, { status: "ok", mode: "plaintext" }, 200);
      } else {
        const env = body as EnvelopeV1;
        const kek = process.env.NOCK_ESTATE_KEK || process.env.NOCK_STATS_KEK;
        if (!kek) return errJson(c, "server missing NOCK_ESTATE_KEK", 500);
        envelopeDecryptToSnapshot(env, kek);
        await statsStore.saveEnvelope(repoId, env);
        return okJson(c, { status: "ok", mode: "envelope" }, 200);
      }
    } catch (e: any) {
      return errJson(c, e?.message || "invalid request", 400);
    }
  });
  // GET /v1/estate/:repoId
  app.get("/v1/estate/:repoId", async (c) => {
    const repoId = c.req.param("repoId");
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_ESTATE === "1" || process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    if (isDevPlain) {
      const pt = await statsStore.loadPlaintext(repoId);
      if (!pt) return errJson(c, "not found", 404);
      return okJson(c, pt, 200);
    } else {
      const env = await statsStore.loadEnvelope(repoId);
      if (!env) return errJson(c, "not found", 404);
      const kek = process.env.NOCK_ESTATE_KEK || process.env.NOCK_STATS_KEK;
      if (!kek) return errJson(c, "server missing NOCK_ESTATE_KEK", 500);
      try {
        const snap = envelopeDecryptToSnapshot(env, kek);
        return okJson(c, snap, 200);
      } catch (e: any) {
        return errJson(c, "decrypt failed", 500);
      }
    }
  });

  // --- Policy + Audit routes (D1-backed in Workers; in-memory in local/dev tests) ---
  function getPolicyAuditStore(c: any): PolicyAuditStore {
    if (policyAuditFactory) return policyAuditFactory({ env: c.env });
    // Default to in-memory for local server/tests
    if (!(globalThis as any).__nockInMemPolicyAudit) {
      (globalThis as any).__nockInMemPolicyAudit = new InMemoryPolicyAuditStore();
    }
    return (globalThis as any).__nockInMemPolicyAudit as InMemoryPolicyAuditStore;
  }

  // GET /v1/policy/:repoId
  app.get("/v1/policy/:repoId", async (c) => {
    const auth = requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const repoParam = c.req.param("repoId");
    const orgHeader = c.req.header("x-nock-org-id") || c.req.query("orgId") || undefined;
    const { orgId, repoId } = parseOrgRepo(repoParam, orgHeader || undefined);
    // 1) repo-scoped
    const repoRec = await store.getLatestPolicy(orgId || "", repoId);
    if (repoRec) return okJson(c, repoRec.body, 200);
    // 2) org default
    if (orgId) {
      const orgRec = await store.getLatestPolicy(orgId, null);
      if (orgRec) return okJson(c, orgRec.body, 200);
    }
    return errJson(c, "not found", 404);
  });

  // PUT /v1/policy/:repoId
  app.put("/v1/policy/:repoId", async (c) => {
    const auth = requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const repoParam = c.req.param("repoId");
    const orgHeader = c.req.header("x-nock-org-id") || c.req.query("orgId") || undefined;
    const scope = (c.req.header("x-nock-policy-scope") || "").toLowerCase();
    const { orgId, repoId } = parseOrgRepo(repoParam, orgHeader || undefined);
    if (!orgId) return errJson(c, "orgId required (header x-nock-org-id or owner/repo)", 400);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return errJson(c, "invalid JSON body", 400);
    }
    // Minimal shape check
    const pack = body as PolicyPack;
    if (!pack || typeof pack !== "object" || !pack.id || !pack.rules) {
      return errJson(c, "invalid policy pack", 400);
    }
    const repoField: string | null = scope === "org" ? null : repoId;
    const { version } = await store.putPolicy(orgId, repoField, pack);
    return okJson(c, { status: "ok", version }, 200);
  });

  // POST /v1/audit
  app.post("/v1/audit", async (c) => {
    const auth = requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return errJson(c, "invalid JSON body", 400);
    }
    const { org_id, repo_id, sql_hash, verdict, rule_ids } = body || {};
    if (!org_id || !repo_id || !sql_hash || !verdict || !Array.isArray(rule_ids)) {
      return errJson(c, "missing required fields", 400);
    }
    await store.appendAudit({
      org_id,
      repo_id,
      sql_hash,
      verdict: verdict === "pass" ? "pass" : "fail",
      rule_ids,
      policy_version: body?.policy_version,
      actor: body?.actor,
      ci_run_id: body?.ci_run_id,
    });
    // Opportunistic retention pruning
    const days = Number(process.env.NOCK_AUDIT_RETENTION_DAYS || 30) || 30;
    try {
      await store.pruneOld(days);
    } catch {
      // ignore pruning errors
    }
    return okJson(c, { status: "ok" }, 200);
  });

  // GET /v1/audit/:repoId
  app.get("/v1/audit/:repoId", async (c) => {
    const auth = requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const repoId = c.req.param("repoId");
    const limit = Number(c.req.query("limit") || 50) || 50;
    const rows = await store.listAuditByRepo(repoId, limit);
    // Map rule_ids_json → rule_ids
    const out = rows.map((r) => ({
      id: r.id,
      org_id: r.org_id,
      repo_id: r.repo_id,
      sql_hash: r.sql_hash,
      verdict: r.verdict,
      rule_ids: r.rule_ids,
      policy_version: r.policy_version,
      actor: r.actor,
      ci_run_id: r.ci_run_id,
      created_at: r.created_at,
    }));
    return okJson(c, out, 200);
  });

  return app;
}

