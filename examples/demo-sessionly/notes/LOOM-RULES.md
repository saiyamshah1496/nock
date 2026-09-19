# Loom narration — which rules fire

## Staging (`estate-staging.json`, n_live_tup=200)
- `naive-bad.sql` → **pass** or soft yellow only (below size gates).

## Prod (live DATABASE_URL / sync-estate, ~500k)
| Statement in naive-bad.sql | Primary rules |
|----------------------------|---------------|
| `CREATE INDEX ... (archived_at)` without CONCURRENTLY | **R001** (often **R010** lock_timeout) |
| `ADD COLUMN ... DEFAULT now()` | **R003** volatile default rewrite |
| `ALTER COLUMN user_id SET NOT NULL` | **R005** (needs nullable `user_id` present) |

## good.sql
- CONCURRENTLY + `lock_timeout` → clears R001/R010 for index
- Nullable ADD COLUMN → clears R003
- `CHECK (...) NOT VALID` → safer expand vs immediate SET NOT NULL (R005)

Prep: run `sql/prod-add-user-id.sql` once on prod if `user_id` missing; ANALYZE; confirm ~500k rows.
