# 017 — npm scope and package names

Decision: publish Nock packages under the `@nockhq` npm scope. The `@nock` scope is widely recognized for the HTTP mocking library; to avoid confusion and namespace conflict, this repo’s publishable packages use `@nockhq/*`.

- Branding remains “Nock” across docs and UI.
- Package names only change to `@nockhq/*`.
- Publishable packages in this repo:
  - `@nockhq/core`
  - `@nockhq/cli` (bin `nock`)
  - `@nockhq/mcp` (bin `nock-mcp`)
  - `@nockhq/secure-estate`

Source uses `workspace:*` versions in the monorepo; pnpm resolves these on publish. Public packages set `publishConfig.access = public` and include only `dist` in published files.
