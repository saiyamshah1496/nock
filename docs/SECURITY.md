# Security notes

Short scope and data handling summary.

- Nock never applies migrations. It only parses your migration SQL and evaluates it against an estate snapshot.
- Free modes (Bring your own estate, Sync estate yourself) keep estate generation and storage on your own runner/repo. The estate contains table sizes and Postgres version — no row data.
- The free path does not require a production DSN in CI. Use a read‑only role and prefer a read replica for `sync-estate`.
- Paid Team (hosted) encrypts estate at rest (AES‑GCM envelope) and requires a bearer token. Dev plaintext mode is local‑only.
- The GitHub Action and CLI accept file paths and environment variables. Do not commit secrets; store them as repository or organization secrets.

Report issues: open an issue with minimal details first; we’ll coordinate a secure channel if needed.

