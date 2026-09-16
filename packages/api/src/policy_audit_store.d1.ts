import type { PolicyAuditStore, PolicyPack, PolicyRecord, AuditEventInput, AuditEventRow } from "./policy_audit_store";

type D1Database = any; // Avoid dev dep on workers types

export class D1PolicyAuditStore implements PolicyAuditStore {
  private db: D1Database;
  private retentionDays: number;
  constructor(db: D1Database, opts?: { retentionDays?: number }) {
    this.db = db;
    this.retentionDays = opts?.retentionDays ?? (Number(process.env.NOCK_AUDIT_RETENTION_DAYS || "30") || 30);
  }

  async getLatestPolicy(orgId: string, repoId: string | null): Promise<PolicyRecord | null> {
    const res = await this.db
      .prepare(
        `
        SELECT org_id, repo_id, version, body_json, created_at
        FROM policies
        WHERE org_id = ?1 AND ( (?2 IS NULL AND repo_id IS NULL) OR repo_id = ?2 )
        ORDER BY version DESC, created_at DESC
        LIMIT 1
        `
      )
      .bind(orgId, repoId)
      .first();
    if (!res) return null;
    return {
      orgId: res.org_id as string,
      repoId: (res.repo_id as string) ?? null,
      version: Number(res.version),
      body: JSON.parse(res.body_json as string) as PolicyPack,
      createdAt: String(res.created_at),
    };
  }

  async putPolicy(orgId: string, repoId: string | null, body: PolicyPack): Promise<{ version: number }> {
    const cur = await this.db
      .prepare(
        `
        SELECT COALESCE(MAX(version), 0) AS maxv
        FROM policies
        WHERE org_id = ?1 AND ( (?2 IS NULL AND repo_id IS NULL) OR repo_id = ?2 )
        `
      )
      .bind(orgId, repoId)
      .first();
    const next = Number(cur?.maxv || 0) + 1;
    const bodyJson = JSON.stringify(body);
    await this.db
      .prepare(
        `
        INSERT INTO policies (org_id, repo_id, version, body_json)
        VALUES (?1, ?2, ?3, ?4)
        `
      )
      .bind(orgId, repoId, next, bodyJson)
      .run();
    return { version: next };
  }

  async appendAudit(ev: AuditEventInput): Promise<void> {
    await this.db
      .prepare(
        `
        INSERT INTO audit_events (org_id, repo_id, sql_hash, verdict, rule_ids_json, policy_version, actor, ci_run_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        `
      )
      .bind(
        ev.org_id,
        ev.repo_id,
        ev.sql_hash,
        ev.verdict,
        JSON.stringify(ev.rule_ids || []),
        ev.policy_version ?? null,
        ev.actor ?? null,
        ev.ci_run_id ?? null
      )
      .run();
  }

  async listAuditByRepo(repoId: string, limit: number): Promise<AuditEventRow[]> {
    const lim = Math.max(1, Math.min(200, limit || 50));
    const { results } = await this.db
      .prepare(
        `
        SELECT id, org_id, repo_id, sql_hash, verdict, rule_ids_json, policy_version, actor, ci_run_id, created_at
        FROM audit_events
        WHERE repo_id = ?1
        ORDER BY created_at DESC
        LIMIT ${lim}
        `
      )
      .bind(repoId)
      .all();
    return (results || []).map((r: any) => ({
      id: Number(r.id),
      org_id: String(r.org_id),
      repo_id: String(r.repo_id),
      sql_hash: String(r.sql_hash),
      verdict: String(r.verdict) as "pass" | "fail",
      rule_ids: JSON.parse(String(r.rule_ids_json) || "[]"),
      policy_version: r.policy_version != null ? Number(r.policy_version) : undefined,
      actor: r.actor != null ? String(r.actor) : undefined,
      ci_run_id: r.ci_run_id != null ? String(r.ci_run_id) : undefined,
      created_at: String(r.created_at),
    }));
  }

  async pruneOld(days?: number): Promise<number> {
    const d = days ?? this.retentionDays;
    const { meta } = await this.db
      .prepare(
        `
        DELETE FROM audit_events
        WHERE created_at < datetime('now', ?1)
        `
      )
      .bind(`-${Number(d)} days`)
      .run();
    // D1 returns changes count in meta?.changes
    return Number((meta && meta.changes) || 0);
  }
}

