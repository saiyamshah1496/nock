import { Hono } from "hono";
import type { EstateStore } from "./store";
import type { EstateSnapshot } from "@nockhq/core";
import { PUSH_SKEW_MS } from "@nockhq/core";
import { envelopeDecryptToSnapshot, type EnvelopeV1 } from "@nockhq/secure-estate";
import {
  InMemoryPolicyAuditStore,
  type PolicyAuditStore,
  type PolicyAuditStoreFactory,
  type PolicyPack,
} from "./policy_audit_store";
import { handleWebhook } from "./github_app";

function requireToken(c: any): string | null {
  const header = c.req.header("authorization") || c.req.header("Authorization");
  if (!header) return null;
  const m = header.match(/^Bearer (.+)$/i);
  return m ? m[1] : null;
}

// Compute SHA-256 hex of the given ASCII/UTF-8 string.
async function sha256Hex(input: string): Promise<string> {
  // Prefer Web Crypto (Workers)
  try {
    // @ts-ignore
    const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
    if (subtle) {
      const enc = new TextEncoder();
      const digest = await subtle.digest("SHA-256", enc.encode(input));
      const arr = new Uint8Array(digest);
      let hex = "";
      for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, "0");
      return hex;
    }
  } catch {
    // fall through to node
  }
  // Node fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("crypto");
  const h = nodeCrypto.createHash("sha256");
  h.update(input, "utf8");
  return h.digest("hex");
}

function okJson(c: any, body: any, status = 200) {
  return c.json(body, status);
}
function errJson(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

/**
 * Authentication (PR5):
 * - Prefer D1-backed hashed token lookup (tokens.token_hash; revoked_at IS NULL). Attaches org_id to context.
 * - Env-bearer fallback (single-tenant; no org scoping) is DISABLED by default and can be enabled
 *   only for staff/dev via an explicit flag: NOCK_ALLOW_ENV_BEARER=1. When enabled, the presented
 *   bearer is compared against NOCK_TEAM_API_TOKEN (preferred) or NOCK_ESTATE_API_TOKEN / NOCK_STATS_API_TOKEN.
 * Returns:
 *   - presented token string on success
 *   - "__MISSING_CONFIG__" if neither D1 nor (staff-enabled) env bearer is configured at all
 *   - null on unauthorized
 */
async function requireAuth(c: any): Promise<string | "__MISSING_CONFIG__" | null> {
  const presented = requireToken(c);
  // Quick reject if no header and we do have some auth configured
  const envToken =
    process.env.NOCK_TEAM_API_TOKEN ||
    process.env.NOCK_ESTATE_API_TOKEN ||
    process.env.NOCK_STATS_API_TOKEN ||
    "";
  const allowEnvBearer =
    String(c?.env?.NOCK_ALLOW_ENV_BEARER || process.env.NOCK_ALLOW_ENV_BEARER || "") === "1";
  const hasEnvConfigured = !!envToken && allowEnvBearer;
  const hasD1 = !!c?.env?.NOCK_D1 && typeof c.env.NOCK_D1.prepare === "function";
  if (!presented) {
    // If nothing configured at all, surface missing-config; else unauthorized
    return hasD1 || hasEnvConfigured ? null : "__MISSING_CONFIG__";
  }
  // 1) Prefer D1 hashed-token path when NOCK_D1 binding is present
  if (hasD1) {
    try {
      const hash = await sha256Hex(presented);
      const row = await c.env.NOCK_D1.prepare(
        `
        SELECT org_id
        FROM tokens
        WHERE token_hash = ?1 AND revoked_at IS NULL
        LIMIT 1
        `
      )
        .bind(hash)
        .first();
      if (row && row.org_id) {
        // Attach org to request context for downstream use
        try {
          c.set && c.set("orgId", String(row.org_id));
        } catch {
          // ignore context set failures in local tests
        }
        // Opportunistic last_used_at update (best-effort)
        try {
          await c.env.NOCK_D1.prepare(
            `UPDATE tokens SET last_used_at = datetime('now') WHERE token_hash = ?1`
          )
            .bind(hash)
            .run();
        } catch {
          // best-effort only
        }
        return presented;
      }
    } catch {
      // Fall through to env fallback
    }
  }
  // 2) Fallback to env bearer tokens (single-tenant; no org scoping) — staff/dev only
  if (hasEnvConfigured) {
    if (presented === envToken) {
      return presented;
    }
    return null; // configured but mismatch
  }
  // 3) If D1 is present but hash didn't match, treat as unauthorized; else truly misconfigured
  return hasD1 ? null : "__MISSING_CONFIG__";
}

function parseOrgRepo(repoId: string, orgIdHeader?: string | null): { orgId?: string; repoId: string } {
  if (repoId.includes("/")) {
    const [orgId] = repoId.split("/", 1);
    return { orgId, repoId };
  }
  const orgId = orgIdHeader || undefined;
  return { orgId, repoId };
}

function getCtxOrgId(c: any): string | undefined {
  try {
    return c.get && typeof c.get === "function" ? (c.get("orgId") as string | undefined) : undefined;
  } catch {
    return undefined;
  }
}

// Resolve "owner/repo" for scoped tokens, enforcing org boundaries when present.
// - If token has org (set by requireAuth), owner MUST equal org, else null.
// - For env bearer (no org in context), pass through as-is.
function resolveScopedOwnerRepo(c: any, owner: string, repo: string): string | null {
  const ctxOrg = getCtxOrgId(c);
  if (!ctxOrg) return `${owner}/${repo}`;
  return owner === ctxOrg ? `${owner}/${repo}` : null;
}

export function createApp(
  statsStore: EstateStore,
  policyAuditFactory?: PolicyAuditStoreFactory
) {
  const app = new Hono();
  // Health
  app.get("/healthz", (c) => c.text("ok"));
  // GitHub App webhook (PR1: always-Neutral check_run on relevant PR events)
  app.post("/github/webhook", async (c) => {
    const raw = await c.req.arrayBuffer();
    return await handleWebhook(c, raw);
  });
  // POST /v1/estate/:owner/:repo
  app.post("/v1/estate/:owner/:repo", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    // Canonical storage id: "owner/repo" (enforce org owner for org-scoped tokens)
    const repoId = resolveScopedOwnerRepo(c, owner, repo);
    if (!repoId) return errJson(c, "not found", 404); // org-scoped token, wrong owner
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_ESTATE === "1" || process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    try {
      const body = await c.req.json();
      if (isDevPlain) {
        const snapshot = body as EstateSnapshot;
        // Enforce freshness skew: reject if captured_at deviates > 1 hour from server time
        const cap = snapshot?.captured_at ? Date.parse(String(snapshot.captured_at)) : NaN;
        if (Number.isFinite(cap) && Math.abs(Date.now() - cap) > PUSH_SKEW_MS) {
          return errJson(c, "captured_at skew exceeds 1 hour", 400);
        }
        await statsStore.savePlaintext(repoId, snapshot);
        return okJson(c, { status: "ok", mode: "plaintext" }, 200);
      } else {
        const env = body as EnvelopeV1;
        const kek = process.env.NOCK_ESTATE_KEK || process.env.NOCK_STATS_KEK;
        if (!kek) return errJson(c, "server missing NOCK_ESTATE_KEK", 500);
        const snap = envelopeDecryptToSnapshot(env, kek);
        const cap = snap?.captured_at ? Date.parse(String(snap.captured_at)) : NaN;
        if (Number.isFinite(cap) && Math.abs(Date.now() - cap) > PUSH_SKEW_MS) {
          return errJson(c, "captured_at skew exceeds 1 hour", 400);
        }
        await statsStore.saveEnvelope(repoId, env);
        return okJson(c, { status: "ok", mode: "envelope" }, 200);
      }
    } catch (e: any) {
      return errJson(c, e?.message || "invalid request", 400);
    }
  });
  // GET /v1/estate/:owner/:repo
  app.get("/v1/estate/:owner/:repo", async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    // Optional auth: when present and org-scoped, resolve to scoped key; otherwise pass-through.
    // GET remains readable without auth for backward compatibility.
    const hasAuthHeader = !!requireToken(c);
    let selectedRepoId: string | null = null;
    if (hasAuthHeader) {
      const auth = await requireAuth(c);
      // Only use scoping when authorized and org is attached; else fall back to pass-through.
      if (auth && auth !== "__MISSING_CONFIG__") {
        selectedRepoId = resolveScopedOwnerRepo(c, owner, repo);
        if (selectedRepoId === null) return errJson(c, "not found", 404); // wrong owner under org token
      }
    }
    const key = selectedRepoId || `${owner}/${repo}`;
    const isDevPlain = process.env.NOCK_DEV_PLAINTEXT_ESTATE === "1" || process.env.NOCK_DEV_PLAINTEXT_STATS === "1";
    if (isDevPlain) {
      const pt = await statsStore.loadPlaintext(key);
      if (!pt) return errJson(c, "not found", 404);
      return okJson(c, pt, 200);
    } else {
      const env = await statsStore.loadEnvelope(key);
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

  // --- PR2: Export routes (estate + audit) ---
  // GET /v1/export/estate/:owner/:repo?format=envelope|plaintext
  app.get("/v1/export/estate/:owner/:repo", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoId = resolveScopedOwnerRepo(c, owner, repo);
    if (!repoId) return errJson(c, "not found", 404); // org-scoped token, wrong owner
    const format = (c.req.query("format") || "envelope").toLowerCase();
    if (format !== "envelope" && format !== "plaintext") {
      return errJson(c, "invalid format", 400);
    }
    if (format === "envelope") {
      const env = await statsStore.loadEnvelope(repoId);
      if (!env) return errJson(c, "not found", 404);
      return okJson(c, env, 200);
    } else {
      // plaintext: prefer decrypting envelope; fallback to dev plaintext when available
      const env = await statsStore.loadEnvelope(repoId);
      if (env) {
        const kek = process.env.NOCK_ESTATE_KEK || process.env.NOCK_STATS_KEK;
        if (!kek) return errJson(c, "server missing NOCK_ESTATE_KEK", 500);
        try {
          const snap = envelopeDecryptToSnapshot(env as EnvelopeV1, kek);
          return okJson(c, snap, 200);
        } catch {
          return errJson(c, "decrypt failed", 500);
        }
      }
      const pt = await statsStore.loadPlaintext(repoId);
      if (!pt) return errJson(c, "not found", 404);
      return okJson(c, pt, 200);
    }
  });

  // GET /v1/export/audit/:owner/:repo?since=&until=&format=jsonl|json
  app.get("/v1/export/audit/:owner/:repo", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoId = resolveScopedOwnerRepo(c, owner, repo);
    if (!repoId) return errJson(c, "not found", 404); // org-scoped token, wrong owner
    const format = (c.req.query("format") || "jsonl").toLowerCase();
    if (format !== "jsonl" && format !== "json") {
      return errJson(c, "invalid format", 400);
    }
    const since = c.req.query("since") || undefined;
    const until = c.req.query("until") || undefined;
    // Validate timestamps if provided
    if (since && !Number.isFinite(Date.parse(String(since)))) return errJson(c, "invalid since", 400);
    if (until && !Number.isFinite(Date.parse(String(until)))) return errJson(c, "invalid until", 400);
    const rows = await store.exportAuditByRepo(repoId, { since, until });
    // Map to export shape (include enrichment where present)
    const out = rows.map((r) => ({
      id: r.id,
      org_id: r.org_id,
      repo_id: r.repo_id,
      sql_hash: r.sql_hash,
      verdict: r.verdict,
      rule_ids: r.rule_ids,
      estate_captured_at: r.estate_captured_at,
      freshness: r.freshness,
      rule_hits: r.rule_hits,
      policy_version: r.policy_version,
      actor: r.actor,
      ci_run_id: r.ci_run_id,
      created_at: r.created_at,
    }));
    if (format === "json") {
      return okJson(c, out, 200);
    } else {
      const ndjson = out.map((o) => JSON.stringify(o)).join("\n") + "\n";
      return new Response(ndjson, {
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      });
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

  // GET /v1/policy/:owner (org default)
  app.get("/v1/policy/:owner", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const orgId = c.req.param("owner");
    const orgRec = await store.getLatestPolicy(orgId, null);
    if (orgRec) return okJson(c, orgRec.body, 200);
    return errJson(c, "not found", 404);
  });

  // GET /v1/policy/:owner/:repo (repo-level with fallback to org default)
  app.get("/v1/policy/:owner/:repo", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const orgId = c.req.param("owner");
    const repoId = c.req.param("repo");
    // Repo-level first
    const repoRec = await store.getLatestPolicy(orgId || "", repoId);
    if (repoRec) return okJson(c, repoRec.body, 200);
    // Fallback to org default
    const orgRec = await store.getLatestPolicy(orgId, null);
    if (orgRec) return okJson(c, orgRec.body, 200);
    return errJson(c, "not found", 404);
  });

  // PUT /v1/policy/:owner (org default)
  app.put("/v1/policy/:owner", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const orgId = c.req.param("owner");
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
    const { version } = await store.putPolicy(orgId, null, pack);
    return okJson(c, { status: "ok", version }, 200);
  });

  // POST /v1/audit
  app.post("/v1/audit", async (c) => {
    const auth = await requireAuth(c);
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
    // Optional enrichment
    const estate_captured_at: string | undefined =
      typeof body?.estate_captured_at === "string" ? body.estate_captured_at : undefined;
    const f = String(body?.freshness || "").toLowerCase();
    const freshness: "fresh" | "warn" | "stale" | "missing" | undefined =
      f === "fresh" || f === "warn" || f === "stale" || f === "missing" ? (f as any) : undefined;
    const rule_hits = Array.isArray(body?.rule_hits) ? body.rule_hits : undefined;
    await store.appendAudit({
      org_id,
      repo_id,
      sql_hash,
      verdict: verdict === "pass" ? "pass" : "fail",
      rule_ids,
      estate_captured_at,
      freshness,
      rule_hits,
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

  // GET /v1/audit/:owner/:repo
  app.get("/v1/audit/:owner/:repo", async (c) => {
    const auth = await requireAuth(c);
    if (auth === "__MISSING_CONFIG__") return errJson(c, "server not configured", 500);
    if (auth === null) return errJson(c, "unauthorized", 401);
    const store = getPolicyAuditStore(c);
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const repoId = resolveScopedOwnerRepo(c, owner, repo);
    if (!repoId) return errJson(c, "not found", 404); // org-scoped token, wrong owner
    const limit = Number(c.req.query("limit") || 50) || 50;
    const rows = await store.listAuditByRepo(repoId, limit);
    // Map rule_ids_json → rule_ids and include enrichment
    const out = rows.map((r) => ({
      id: r.id,
      org_id: r.org_id,
      repo_id: r.repo_id,
      sql_hash: r.sql_hash,
      verdict: r.verdict,
      rule_ids: r.rule_ids,
      estate_captured_at: r.estate_captured_at,
      freshness: r.freshness,
      rule_hits: r.rule_hits,
      policy_version: r.policy_version,
      actor: r.actor,
      ci_run_id: r.ci_run_id,
      created_at: r.created_at,
    }));
    return okJson(c, out, 200);
  });

  return app;
}

