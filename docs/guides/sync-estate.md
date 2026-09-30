# Keep estate fresh with sync-estate (Free path)

Goal: generate `.nock/estate.json` on your own runner (no hosted service) and run PR checks that only read that file — no database secrets on PR jobs.

Free path, copy‑pasteable:
- Schedule or manually run `sync-estate` to write `.nock/estate.json` on your runner (commit‑back or upload as an artifact).
- PR check uses the Marketplace Action with `estate-path` to read the file — no `DATABASE_URL` / `PG_ESTATE_URL` in the PR job.

CLI ≡ Action ≡ MCP — same verdict surface. This guide shows the Free file path with the Marketplace Action.

On your side — quick checklist
- Create a least‑privilege read‑only role (see [`grants-sync-estate.md`](./grants-sync-estate.md)). Phase‑1 catalogue reads `pg_attribute`, `pg_constraint`, `pg_index` in addition to sizes — not just stats.
- Prefer a read‑replica; store its DSN in a repo secret used by the sync job only (example: `NOCK_DATABASE_URL`).
- Use a recent CLI that emits catalogue sections; re‑run `sync-estate` so `.nock/estate.json` contains `columns[]`/`constraints[]`/`indexes[]` (or present‑but‑empty `[]` when none).
- Make the estate available to PR checks: commit `.nock/estate.json` or upload it as an artifact. PR jobs read the file only.
- Keep it fresh: schedule syncs. When catalogue sections are omitted, catalogue‑aware rules fail‑closed.

What sync-estate captures (catalogue overview):
- Table sizes and version metadata
- Table shape signals on each entry: relkind and replica_identity
- Additive catalogue sections:
  - columns[]: not_null, type_name, presence-only has_default (never default SQL text)
  - constraints[]: kind (check|fk|pk|unique|exclude|...), validated, columns[], supporting_index?
  - indexes[]: unique, primary, valid, ready, immediate, columns[], replica_identity?
Omit vs empty: an omitted section key means “catalogue absent” (fail‑closed for catalogue‑aware rules); a present‑but‑empty [] means “synced; none found”.

## Proof in this repo

This repository runs a self‑contained integration that proves the “sync‑estate → check” loop against a real Postgres service container. See `/.github/workflows/ci.yml` job `estate-sync-integration` for a complete example:
- Boots Postgres as a service and waits for health
- Seeds a “hot” table and a tiny table (`fixtures/ci-estate/seed.sql`)
- Runs `nock sync-estate` to write `.nock/estate.json`
- Checks one SQL that should RED on the hot table and one that should PASS on the tiny table

## Grants for sync

Use a dedicated role that can read catalog/statistics only — not table rows. Provider nuances vary; see the one‑pager: [`grants-sync-estate.md`](./grants-sync-estate.md).


In your repo: Settings → Secrets and variables → Actions → New secret
- Use a read‑only DSN secret for the sync job only (example: `NOCK_DATABASE_URL` as in the example workflow).

## 1) Sync job → `.nock/estate.json`

Use the real example from this repo: `examples/workflows/nock-sync-estate-file.yml`.
- Connects with a read‑only DSN secret (`NOCK_DATABASE_URL`).
- Runs `npx @nockhq/cli sync-estate` and writes `.nock/estate.json`.
- Default persistence: commits `.nock/estate.json` back via PR so PR runners have the file without any prod DSN.
- Alternative (commented in the example): upload a short‑lived artifact if your pipeline prefers to download it.
<!-- See the YAML in examples/workflows/nock-sync-estate-file.yml -->

Note for monorepo contributors: you can continue to use the workspace binary (e.g. `node packages/cli/dist/bin/nock.js`) when developing inside this repo.

Tips
- Keep `.nock/estate.json` in the repo (commit) or publish it as an artifact.
- Estate contains Postgres sizes/version and a governance catalogue (columns, constraints, indexes) — no row data and no SQL/expressions. We never store default expressions, CHECK/index predicates, or generated expressions.

## 2) PR check — Action reads the file (no DB on PR)

Use the Marketplace Action pinned to the latest release touched here: `saiyamshah1496/nock-action@v0.1.10`. Point it at your estate file:

```yaml
name: Nock — Postgres migration safety (Action, file estate)
on:
  pull_request:
    paths:
      - "migrations/**"
      - ".nock/**"
jobs:
  nock:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Nock check (Action)
        uses: saiyamshah1496/nock-action@v0.1.10
        with:
          migration-path: migrations/
          estate-path: .nock/estate.json
          policy-path: policy.default.yml
          fail-on: red
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Tip: need a custom location? Configure `estate-path` — see [`estate-path.md`](./estate-path.md).

 

 

See also
- `examples/workflows/nock-sync-push.yml` shows an optional “push to hosted estate API (Nock Team)” job.
- [`docs/guides/quick-start-estate-file.md`](./quick-start-estate-file.md) for a zero‑DB, paste/file quickstart.

## Freshness

Nock neutralizes stale estates consistently across Action/App:
- Warn when `captured_at` is older than 7 days.
- Neutralize size‑gated rules when 30+ days old; non‑size rules still apply.
- Committed files and artifacts age identically.
Details: see [`docs/freshness.md`](../freshness.md).

## Team path (optional)

Want to push to the hosted estate API (Nock Team) and have the Action fetch it? See `examples/workflows/nock-sync-push.yml`. You can still keep `estate-path` as a fallback file.

