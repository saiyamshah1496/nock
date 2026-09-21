# Getting started

Goal: run Nock in minutes and see approve/block on your migrations. CLI ≡ Action ≡ MCP — the same verdict JSON for the same inputs.

## Step 1 — Get an estate (pick one)
- Bring your own estate: commit `.nock/estate.json` (start from `fixtures/estate_billion.json` to simulate large tables)
- Sync estate yourself (recommended):  
  `npx @nockhq/cli@latest sync-estate --database-url "$DATABASE_URL" --out .nock/estate.json`
- Live DATABASE_URL check (no file):  
  pass `--database-url` (or set `DATABASE_URL`) to refresh the estate in‑memory, then evaluate

Notes
- “Estate” = table sizes + optional governance catalogue (columns, constraints, indexes). No row data.
- Omit vs [] semantics: omitting a catalogue section key means “catalogue absent” (catalogue‑aware rules fail‑closed); a present‑but‑empty `[]` means “synced; none found”. See `docs/reference/estate-schema.md`.

Custom estate path
- Default lookup is `.nock/estate.json` on the PR head (falls back to base)
- Or configure `estate-path:` in `nock.yml` (repo root or `.github/`):
  ```yaml
  estate-path: config/estate.json
  ```

## Step 2 — Check locally (CLI)

```bash
npx @nockhq/cli@latest check \
  --sql migrations/001.sql \
  --estate .nock/estate.json \
  --policy policy.default.yml \
  --fail-on red \
  --format json
```

Exit codes: 0 pass · 1 warn · 2 fail

## Step 3 — Run in CI or Cursor
- CI (CLI-first): use `examples/workflows/nock.yml` or copy the snippet from the README
- MCP (agents): install `@nockhq/mcp@latest` and call `check_before_apply` (guide: `./mcp-check-before-apply.md`)

Next
- Keep the estate fresh on your runner: `./sync-estate.md`

