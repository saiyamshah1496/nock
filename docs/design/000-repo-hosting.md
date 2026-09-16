# 000 — Repo hosting for Nock Phase 1

Goal: Unblock cloud coding agents so Phase 1 can land in a real remote.

## Options

| Option | Pros | Cons | GTM | Cost |
|--------|------|------|-----|------|
| A. Cursor Origin new_repo | Native cloud-agent greenfield; PR/main on Origin | Needs Origin namespace setup first (one-time) | Fast after setup | $0 |
| B. Empty GitHub repo `saiyamshah1496/nock` | GitHub already connected to Cursor; familiar; Action lives on GH anyway | Manual create once | Fastest if you can click “new repo” now | $0 |
| C. Scaffold only on a local box | Unblocks local typing immediately | Not source of truth; messy handoff; violates preferred cloud-agent path | False speed | Hidden merge cost |

## Decision

Prefer B for Phase 1 GTM because GitHub is already connected and the GitHub Action is a Phase 1 distribution surface — living on GitHub from commit 1 avoids a later forge hop. Also create an Origin namespace when convenient for future greenfield; not on the critical path if B works. Reject C as primary.

## Acceptance criteria

- Cloud agent can launch against `https://github.com/saiyamshah1496/nock` (or Origin equivalent)
- First PR includes this design note

