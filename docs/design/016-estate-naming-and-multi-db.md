# 016 — Estate naming and multi‑DB model

Status: Accepted • Audience: product + engineering • Owner: Saiyam (Founding Engineer) • Date: 2026‑09‑16

## Why “estate”

- “Estate” is the product term for a database’s shape at a point in time — primarily its tables and their sizes/row counts used for safety gating. It is not an acronym.
- We previously used “stats” as Postgres jargon for table statistics; that leaked into user‑facing copy and wire names.
- Decision: prefer “estate” (and “estate snapshot”) in product docs and user‑facing copy. Wire names remain “stats” until a dedicated rename PR ships.

## Glossary

- Estate: a Postgres database environment (e.g., prod‑primary, staging‑readreplica).
- Estate snapshot: the captured table sizes and related counters for one estate at a moment in time; equivalent to today’s `stats.json`.
- Estate ID (`estate_id`): a short identifier for the database/environment within a repo/org (e.g., `prod-primary`, `stg-replica-1`).
- “Stats”: existing wire term used in filenames/paths/commands today; remains supported and documented as an alias during the migration.

## Naming + aliasing plan (no breaking changes in this PR)

We will move product language first, then add non‑breaking aliases, and only later do a wire rename:

1) Docs: adopt “estate / estate snapshot” throughout (this PR).
2) CLI: add aliases so `--estate` == `--stats` where flags reference snapshots (follow‑up PR).
3) API: add `/v1/estate` as an alias to `/v1/stats` (follow‑up PR).
4) File artifact: allow `estate.json` as an alias to `stats.json` (follow‑up PR).
5) Eventually: consider deprecating the “stats” names after a long overlap.

Explicitly retained (current wire names):
- File: `stats.json`
- CLI: `nock sync-stats`
- API: `/v1/stats/:repoId`

## Multi‑DB model (one repo → many estates)

- A single GitHub repository may target multiple Postgres databases (multiple estates). Policy can remain scoped at org/repo.
- Keying: every estate snapshot is uniquely identified by `org + repo + estate_id`.
- V1 evaluation assumes one estate per check execution. Two databases ⇒ run two syncs and store two hosted blobs — never merge table sizes across databases, even if table names match.
- Action/Runners: in a later PR the GitHub Action (and/or CLI) will accept an `--estate-id <id>` (or input `estate-id`) and will include it when pushing/fetching snapshots.

## Non‑goals (this PR)

- No mass code rename of identifiers containing “stats”.
- No API behavior changes or endpoint renames; only documentation language updates.
- No introduction of `estate-id` inputs yet; only documenting the model.
- No merging of data across databases; that’s explicitly unsupported.

## References

- 008 — sync‑stats (Path B): `docs/design/008-sync-stats.md`
- 009 — thin hosted stats API (Path B+): `docs/design/009-hosted-stats-api.md`
- 014 — Action with hosted stats default: `docs/design/014-action-hosted-stats-default.md`

