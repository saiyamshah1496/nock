# 002 — Verdict schema

Goal: A stable JSON VerdictV1 shared by CLI, Action, and MCP with enough fields to render PR comments and drive policy.

Options
- Hand-rolled TS types only: simplest, no runtime validation.
- Zod schema + TS types: runtime validation, clearer contract.
- JSON Schema + codegen: heavier, future API-ready.

Pros/cons
- TS only: +speed; −no runtime validation.
- Zod: +validation; +developer ergonomics; −small dep.
- JSON Schema: +interoperability; −heavier early.

Decision
- TS types now (keep Zod optional for later); schema_version = "1".
- Fields: verdict, statements[], violations[], meta{ pg_version, stats_captured_at, policy_id, engine }.
- Estimated hold reported as {min,max}+label "approximate".

Acceptance criteria
- CLI and MCP emit identical JSON for same inputs (golden test).
- Action markdown is a projection of VerdictV1, no extra inference.

