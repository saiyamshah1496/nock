# 011 — GitHub Actions CI for Nock

Status: Accepted

## Problem

We need a reliable, repo‑local continuous integration pipeline that:
- installs dependencies deterministically,
- typechecks/builds the monorepo,
- runs unit tests (vitest),
- and is green by default without any Cloudflare/R2 or hosted‑API secrets.

We must keep deployment concerns separate (no deploys from this CI).

## Options considered

- GitHub Actions (GHA)
- Cloudflare Pages/Workers Builds

## Decision

Use GitHub Actions for unit/build CI. Keep Cloudflare (Workers/Pages) builds for deploy workflows only, wired separately when needed.

### Why GitHub Actions for unit/build CI

- Proximity to PRs: native checks, annotations, and required‑checks policy.
- First‑class Node support: `actions/setup-node` with `cache: pnpm`, predictable Node 20.
- Our tests do not require R2/Workers — they use file fixtures and local code paths.
- Faster feedback: a single, minimal job that runs `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`.

### Why not Cloudflare Builds for unit CI

- Cloudflare Builds are optimized for deploying Worker/Pages artifacts, not general monorepo unit tests.
- Avoid coupling CI success to CF project/account state or secrets (R2, KEK, API tokens).
- Keeps deployment pipelines cleanly separated, per‑environment.

## Scope of this CI

Workflow: `.github/workflows/ci.yml`
- Triggers: `push` to `main`, all `pull_request`s.
- Runtime: Node 20 via `actions/setup-node@v4`, `corepack enable`, `pnpm` with cache.
- Install: `pnpm install --frozen-lockfile`.
- Build: `pnpm -r build` (workspace packages).
- Test: `pnpm test` (vitest; non‑interactive).
- Failure surface: typecheck, build, or tests failing will fail the job.

Notes:
- Tests intentionally do not require R2/Cloudflare or any hosted service secrets — file store default; any online integrations are skipped when env is unset.
- Deployment (Workers/API) is out of scope here and will be handled by a separate workflow when needed.

## Future improvements

- Add matrix for OS/Node versions if needed (right now Node 20 is our target).
- Optional path‑based filters to short‑circuit when docs‑only changes occur.
- Upload coverage artifact when we add coverage.
- Add concurrency/group to auto‑cancel stale PR runs.

