Nock GitHub Action
==================

This package contains the GitHub Action wrapper for Nock’s DDL safety check.
It is bundled into a single file (`dist/index.js`) so it can run on GitHub Actions
without workspace dependencies.

How to build the bundle
-----------------------

- From the monorepo root:

```bash
pnpm --filter @nockhq/action build
```

- Or build everything:

```bash
pnpm -r build
```

What gets committed
-------------------

- The bundled artifacts under `packages/action/dist/` are intentionally committed
  for maintainers and monorepo equivalence. For public installs, prefer the GitHub
  Marketplace Action:

```yaml
uses: saiyamshah1496/nock-action@<tag>
```

Monorepo equivalent (maintainers only):

```yaml
uses: saiyamshah1496/nock/packages/action@<tag>
```

Notes
-----

- The Action runs on `runs.using: node20` and points `main` to `dist/index.js`.
- GitHub Marketplace listing is live: [Nock — Estate‑aware Postgres DDL](https://github.com/marketplace/actions/nock-estate-aware-postgres-ddl).
