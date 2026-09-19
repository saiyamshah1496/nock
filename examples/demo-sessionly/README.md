# Sessionly — hackathon demo assets (meta only)

**Not shown in the Loom UI.** Open `ui/index.html` for the product app.

## Product UI intent
- Looks like a live Sessionly product (overview + feature requests)
- Naive DDL is drafted by the **agent**, not shown as the starring content of this page
- Staging ~200 / Prod 500k · Supabase us-east-1 badges in header (Saiyam: keep Supabase visible)
- No shape-linter / Nock gate row on this page (that plays in Cursor/Loom)

## Demo constraints
- Demo-only; may not merge to main — Saiyam decides
- No secrets / connection strings in UI
- Fail never appears on Sessionly page

## Open locally
```bash
open examples/demo-sessionly/ui/index.html
```

## Demo flow
UI feature request → Cursor drafts naive DDL → Nock MCP on staging (pass) → same SQL on prod (fail) → narrate + remediate → prod pass.
