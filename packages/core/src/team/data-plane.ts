// Shared types for Team thin-slice data-plane
// Names aligned with FE (#34): Freshness, RuleHitDetail

export type Freshness = "fresh" | "warn" | "stale" | "missing";

// Freshness thresholds
export const FRESHNESS_WARN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const FRESHNESS_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PUSH_SKEW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Compute freshness band of a snapshot captured_at timestamp.
 * - missing when null/undefined/unparseable
 * - fresh when age <= 7d
 * - warn when 7d < age <= 30d
 * - stale when age > 30d
 *
 * Note: push-time skew (captured_at > now + 1h) is enforced at ingestion and is not a Freshness value.
 */
export function computeFreshness(capturedAt: string | Date | null | undefined, now: Date = new Date()): Freshness {
  if (!capturedAt) return "missing";
  const ts = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (isNaN(ts.getTime())) return "missing";
  const ageMs = now.getTime() - ts.getTime();
  if (ageMs <= FRESHNESS_WARN_MS) return "fresh";
  if (ageMs <= FRESHNESS_STALE_MS) return "warn";
  return "stale";
}

export interface RuleHitDetail {
  id: string;
  severity: string;
  table?: string;
  n_live_tup?: number;
  reason_code?: string;
}

export interface AuditEventV1 {
  org_id: string;
  repo_id: string;
  sql_hash: string; // never store full SQL
  verdict: "pass" | "fail";
  // D1 v1 (0001): rule_ids_json stored; export maps to rule_ids
  rule_ids?: string[];
  // Proposed v2 additions (0002): rule_hits_json + metadata
  rule_hits?: RuleHitDetail[];
  policy_version?: number | null;
  estate_captured_at?: string | null;
  freshness?: Freshness | null;
  actor?: string | null;
  ci_run_id?: string | null;
  // Server-populated
  created_at?: string;
}

