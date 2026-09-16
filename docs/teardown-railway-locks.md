# Teardown — Railway incidents and lock modes (stub)

This stub will collect links to official PostgreSQL locking docs and Railway’s incident write-ups (Oct 28, 2025 and Dec 8, 2025), focusing on:

- Non-concurrent CREATE INDEX takes SHARE (blocks writes).
- Nullable ADD COLUMN is metadata-only but can queue behind long readers.
- Why `lock_timeout` and size-awareness matter.

Do not invent unpublished SQL or dollar-loss figures. Cite official sources only.

