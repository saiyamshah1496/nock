import type { EstateSnapshot } from "./index";

export type EstateFreshnessClass =
  | "fresh" // < 7 days old
  | "warn" // >= 7d and <= 30d
  | "neutral_stale" // > 30d, size-gated rules neutralized
  | "reject_skew"; // absolute skew > 1 hour (only for push validation)

export interface EstateFreshness {
  classification: EstateFreshnessClass;
  ageDays?: number;
  skewSeconds?: number;
}

export function evaluateEstateFreshness(
  snapshot: EstateSnapshot,
  nowMs?: number,
  purpose: "classify" | "push-validate" = "classify"
): EstateFreshness {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const cap = snapshot?.captured_at ? Date.parse(String(snapshot.captured_at)) : NaN;
  if (!Number.isFinite(cap)) {
    // Unknown capture time — treat as neutral stale for gating; cannot reject skew
    return { classification: "neutral_stale", ageDays: undefined, skewSeconds: undefined };
  }
  const diffMs = now - cap;
  const skewSecs = Math.abs(Math.round(diffMs / 1000));
  if (purpose === "push-validate" && skewSecs > 3600) {
    return { classification: "reject_skew", ageDays: Math.max(0, Math.floor(diffMs / 86400000)), skewSeconds: skewSecs };
  }
  const ageDays = Math.max(0, Math.floor(diffMs / 86400000));
  if (ageDays > 30) return { classification: "neutral_stale", ageDays, skewSeconds: skewSecs };
  if (ageDays >= 7) return { classification: "warn", ageDays, skewSeconds: skewSecs };
  return { classification: "fresh", ageDays, skewSeconds: skewSecs };
}

