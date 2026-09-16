# 012 — Workers crypto compatibility

Context: Deploying `@nock/api` to Cloudflare Workers failed with:

- Could not resolve `crypto` (referenced by `@nock/secure-stats` → `secure-stats/dist/index.js`).

Workers requires the Node.js built‑ins to be referenced via `node:<module>` and gated behind the Node.js compatibility flag introduced with `compatibility_date >= 2024-09-23`.

## Decision

- Update all imports of Node’s crypto module from `crypto` to `node:crypto` in workspace packages (notably `@nock/secure-stats`).
- Configure Workers compatibility for the API package:
  - `compatibility_date >= 2024-09-23` (we use a current date).
  - Enable `nodejs_compat` in `wrangler.toml`.

## Rationale

- The `node:crypto` specifier is the standard, explicit Node built‑in reference that modern bundlers and Cloudflare Workers resolve correctly.
- The `nodejs_compat` flag on a recent compatibility date enables Node core APIs (Buffer, crypto, etc.) inside Workers without polyfills.
- This preserves Node CLI and local test behavior (no change to Node runtimes) while enabling Workers deploys.

## Implementation notes

- Change secure‑stats import:
  - Before: `import { … } from "crypto"`
  - After: `import { … } from "node:crypto"`
- Keep the package as CommonJS output; Wrangler will bundle from the Workers entry (`packages/api/src/worker.ts`) and handle the dependency graph with `nodejs_compat` enabled.
- Update `packages/api/wrangler.toml.example`:
  - Ensure `compatibility_date` is ≥ 2024‑09‑23 (we set a current date).
  - Set `compatibility_flags = ["nodejs_compat"]`.

## Testing

- `pnpm -r build` and `pnpm -r test` should pass locally without any R2 secrets (file store remains default for tests).

## Migration impact

- Node consumers are unaffected; `node:crypto` works in supported Node versions and is handled by TypeScript/ts-node/esbuild.
- Cloudflare Workers deploys will no longer fail resolving `crypto` and will use the built‑in crypto implementation under Node compatibility.

