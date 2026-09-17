export interface PolicyPack {
  id: string;
  version?: string;
  fail_on: "red" | "yellow";
  require_lock_timeout?: "always" | "size_gated";
  rules: Record<string, any>;
  no_stats?: "warn" | "fail_closed";
}

export interface PolicyRecord {
  orgId: string;
  repoId: string | null; // null => org default
  version: number;
  body: PolicyPack;
  createdAt: string; // ISO
}

// Optional freshness classification for an audit (external classifier; not implemented here)
export type Freshness = "fresh" | "warn" | "stale" | "missing";
export interface RuleHitDetail {
  id: string;
  severity?: string;
  table?: string;
  n_live_tup?: number;
  reason_code?: string;
}

export interface AuditEventInput {
  org_id: string;
  repo_id: string;
  sql_hash: string;
  verdict: "pass" | "fail";
  rule_ids: string[];
  // Optional enrichment fields
  estate_captured_at?: string;
  freshness?: Freshness;
  rule_hits?: RuleHitDetail[];
  policy_version?: number;
  actor?: string;
  ci_run_id?: string;
}

export interface AuditEventRow extends AuditEventInput {
  id: number;
  created_at: string;
}

export interface PolicyAuditStore {
  // Policy
  getLatestPolicy(orgId: string, repoId: string | null): Promise<PolicyRecord | null>;
  putPolicy(orgId: string, repoId: string | null, body: PolicyPack): Promise<{ version: number }>;
  // Audit
  appendAudit(ev: AuditEventInput): Promise<void>;
  listAuditByRepo(repoId: string, limit: number): Promise<AuditEventRow[]>;
  pruneOld(days: number): Promise<number>;
}

export type PolicyAuditStoreFactory = (ctx: { env?: any }) => PolicyAuditStore;

// In-memory implementation for tests/dev
export class InMemoryPolicyAuditStore implements PolicyAuditStore {
  private policies: PolicyRecord[] = [];
  private audits: AuditEventRow[] = [];
  private nextAuditId = 1;

  async getLatestPolicy(orgId: string, repoId: string | null): Promise<PolicyRecord | null> {
    // console.debug("getLatestPolicy", { orgId, repoId, count: this.policies.length });
    const rows = this.policies
      .filter((p) => p.orgId === orgId && p.repoId === repoId)
      .sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
    return rows[0] || null;
  }

  async putPolicy(orgId: string, repoId: string | null, body: PolicyPack): Promise<{ version: number }> {
    // console.debug("putPolicy", { orgId, repoId });
    const current = this.policies.filter((p) => p.orgId === orgId && p.repoId === repoId);
    const next = (current.reduce((m, r) => Math.max(m, r.version), 0) || 0) + 1;
    const rec: PolicyRecord = {
      orgId,
      repoId,
      version: next,
      body,
      createdAt: new Date().toISOString(),
    };
    this.policies.push(rec);
    return { version: next };
  }

  async appendAudit(ev: AuditEventInput): Promise<void> {
    // console.debug("appendAudit", ev);
    const row: AuditEventRow = {
      ...ev,
      id: this.nextAuditId++,
      created_at: new Date().toISOString(),
    };
    this.audits.push(row);
  }

  async listAuditByRepo(repoId: string, limit: number): Promise<AuditEventRow[]> {
    return this.audits
      .filter((a) => a.repo_id === repoId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(0, Math.min(limit, 200)));
  }

  async pruneOld(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const before = this.audits.length;
    this.audits = this.audits.filter((a) => new Date(a.created_at).getTime() >= cutoff);
    return before - this.audits.length;
  }
}

