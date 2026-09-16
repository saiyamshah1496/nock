# 003 — Rule engine

Goal: Deterministic R001–R012 evaluation over parsed statements × estate stats × policy.

Options
- Minimal inline evaluation in matchers: fastest path, fewer seams.
- Pluggable `Rule` interface + registry: clearer expansion, slightly more boilerplate.
- Declarative rules in YAML executed by a VM: overkill now.

Pros/cons
- Inline: +speed; −harder to scale; −test isolation.
- Rule interface: +clarity; +per-rule tests; −setup cost.
- Declarative: −risk and complexity; premature.

Decision
- Introduce `Rule` interface later per-rule files; for Phase 1 wedge, implement core logic inline for R001/R010 and prepare scaffolding for expansion.
- Policy pack keys configure thresholds; default pack checked in.

Acceptance criteria
- Solid R001, R004, R006, R010; others stubbed with explicit TODO in registry (no silent pass).
- Unknown DDL always yields YELLOW parse violation.

