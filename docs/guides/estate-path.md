# Configure a custom estate path

Nock looks for an estate snapshot in your repository when evaluating DDL in pull requests.

Resolution order:
1) `.nock/estate.json` on the PR head (falls back to base)
2) `estate-path:` in `nock.yml` or `.github/nock.yml`
3) If none is found, Nock posts a Neutral check explaining how to add one

Minimal example using `estate-path`:

```yaml
# nock.yml (place at repo root or under .github/)
estate-path: config/estate.json
```

Then commit the referenced file:
- `config/estate.json` — the `EstateSnapshot` JSON (see `docs/guides/quick-start-estate-file.md`)

This keeps your default `.nock/estate.json` location flexible while enabling monorepos to store estates under a shared `config/` directory.

