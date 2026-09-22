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
  so that users can reference the Action via:

```yaml
uses: saiyamshah1496/nock/packages/action@<tag>
```

Notes
-----

- The Action runs on `runs.using: node20` and points `main` to `dist/index.js`.
- GitHub Marketplace listing requires a dedicated public repo with a root `action.yml`;
  this package works via the subdirectory `uses:` reference in the interim.
