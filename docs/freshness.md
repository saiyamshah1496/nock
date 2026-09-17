Nock Team estate freshness (locked)

- Warn when estate `captured_at` is older than 7 days.
- Neutral stale when older than 30 days:
  - Size‑gated rules are neutralized (reds downgraded to yellow).
  - Non‑size rules still apply (e.g., VACUUM FULL).
- API push validation: `POST /v1/estate/:repoId` rejects when `captured_at` skew vs server time exceeds 1 hour (HTTP 400). Envelope format unchanged.
- Missing estate in the App path remains Neutral.

Implementation notes

- Shared helper `evaluateEstateFreshness` in `@nockhq/core` computes age and supports push‑validation mode.
- Core `check()` accepts `noStatsBehavior: "warn"` to neutralize size‑gated rules and annotates `meta.estate_age_hours` and `meta.size_gates_neutralized`.
- Action/App use 7d warn and 30d neutralization consistently.

