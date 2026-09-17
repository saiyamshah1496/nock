# 016 — Estate naming and multi‑DB model

Status: Accepted • Audience: product + engineering • Owner: Saiyam (Founding Engineer) • Date: 2026‑09‑16

## Why “estate”

- “Estate” is the product term for a database’s shape at a point in time — primarily its tables and their sizes/row counts used for safety gating. It is not an acronym.
- We previously used “stats” as Postgres jargon for table statistics; that leaked into user‑facing copy and wire names.
- Decision: prefer “estate” (and “estate snapshot”) in product docs and user‑facing copy. This rename has now landed across wire names as well.

## Glossary

- Estate: a Postgres database environment (e.g., prod‑primary, staging‑readreplica).
- Estate snapshot: the captured table sizes and related counters for one estate at a moment in time; equivalent to today’s `stats.json`.
- Estate ID (`estate_id`): a short identifier for the database/environment within a repo/org (e.g., `prod-primary`, `stg-replica-1`).
- “Stats”: existing wire term used in filenames/paths/commands today; remains supported and documented as an alias during the migration.

## Naming status (rename landed)

The wire rename from “stats” → “estate” is complete in main:

1) Docs: “estate / estate snapshot” adopted.
2) CLI: `--estate` replaces `--stats`; command renamed to `nock sync-estate`.
3) API: `/v1/estate` replaces `/v1/stats`.
4) File artifact: `estate.json` replaces `stats.json`.
5) Packages: `@nockhq/secure-estate` replaces `@nock/secure-stats`.

Temporary compatibility (infra identifiers only):
- Environment secrets: prefer `NOCK_ESTATE_API_TOKEN` / `NOCK_ESTATE_KEK` with fallback to `NOCK_STATS_API_TOKEN` / `NOCK_STATS_KEK`.
- Dev plaintext switch: prefer `NOCK_DEV_PLAINTEXT_ESTATE` with fallback to `NOCK_DEV_PLAINTEXT_STATS`.
- Store selection: prefer `NOCK_ESTATE_STORE` / `NOCK_ESTATE_STORE_DIR` with fallback to `NOCK_STATS_STORE` / `NOCK_STATS_STORE_DIR`.
- Cloudflare R2 bucket name `nock-stats` may remain unchanged.

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

- 008 — sync‑estate (Path B): `docs/design/008-sync-stats.md`
- 009 — thin hosted estate API (Path B+): `docs/design/009-hosted-stats-api.md`
- 014 — Action with hosted estate default: `docs/design/014-action-hosted-stats-default.md`

