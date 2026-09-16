# 013 — Workers entry isolation

Goal: Ensure the Cloudflare Workers entry only depends on Workers‑safe code (Hono app + R2 store) and does not pull Node‑only modules into the bundle.

Key changes
- Introduced `packages/api/src/store.types.ts` for the `StatsStore` interface so type imports in Workers code never load Node modules.
- `packages/api/src/app.ts` now imports `StatsStore` from `store.types` (type‑only), avoiding `store.ts` (Node: fs/path/os).
- `packages/api/src/worker.ts` imports only the Hono app factory and `R2StatsStore`.
- Node server remains separate in `packages/api/src/server.ts` (uses `@hono/node-server`) and selects the store via `store.factory.ts`.
- No barrels re‑export Node and Worker entries together.

Resulting structure
- Workers: `worker.ts` -> `app.ts` (type‑only `StatsStore`) -> runtime `R2StatsStore`
- Node: `server.ts` -> `store.factory.ts` -> `LocalFileStatsStore` (default) or `R2StatsStore` (lazy require)

Wrangler
- `packages/api/wrangler.toml` `main = "src/worker.ts"`; run `wrangler` from repo root with `--config packages/api/wrangler.toml` or `cd packages/api`.
- Cloudflare project root for deploys is `packages/api`.

Optional smoke check
- Comment in `src/worker.ts` documents the constraint to keep Node server and file store out of the Worker dependency graph.

