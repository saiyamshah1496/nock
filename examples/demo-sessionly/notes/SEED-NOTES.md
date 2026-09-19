# Sessionly / Path C demo fixtures (hackathon DEMO-ONLY — may not merge)

## Files
| Path | Role |
|------|------|
| `estate-staging.json` | Phase-1 catalogue estate; `sessions.n_live_tup = 200` → staging checks stay quiet / pass |
| `sql/A-bad-*.sql` / `A-good-*.sql` | CREATE INDEX vs CONCURRENTLY + lock_timeout |
| `sql/B-bad-*.sql` / `B-good-*.sql` | volatile DEFAULT add column vs nullable add |
| `sql/C-bad-*.sql` / `C-good-*.sql` | SET NOT NULL vs NOT VALID CHECK expand |

## Staging estate
Hand-authored to Phase-1 shape (`schema_version: 1`, tables/columns/constraints/indexes).
- Hot table story: `public.sessions` with **200** live tuples (not 500k).
- Columns: `id` (NOT NULL bigint), `archived_at` (nullable timestamptz), `user_id` (nullable bigint for case C), `label` (nullable text for case B contrast).
- PK constraint + primary index present; sections present (not omitted) so catalogue arms are available.

Omit vs empty: this fixture **includes** all three catalogue sections (non-omit). Empty arrays would mean “synced none.”

## Demo flow (suggested)
1. **Staging:** `nock check` (or Action) with `--estate estate-staging.json` + A-bad → should **not** red on size (200 << thresholds) or only soft advice.
2. **Prod:** same A-bad against live sync-estate (~500k) → **R001/R010 red**.
3. Flip to A-good → green / acceptable.
4. B-bad vs B-good on staging then optionally mention prod rewrite risk.
5. C-bad on prod after `user_id` exists → R005 red; staging size soft.

## Prod schema support for case C
Prod was seeded with only `id` + `archived_at`. Demo needs nullable `user_id` for SET NOT NULL:
```sql
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_id bigint;
ANALYZE public.sessions;
SELECT count(*) FROM public.sessions;
SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'sessions';
```
Expect count/n_live_tup still **~500000** after ADD COLUMN (metadata-only).

## ANALYZE
- Staging fixture: static JSON; no ANALYZE.
- Prod: run `ANALYZE public.sessions;` after any ALTER so sync-estate / pg_stat stay honest.

## Grants
Same read-only catalogue story as sync-estate (pg_catalog / pg_stat_user_tables / attributes / constraints / indexes). No app-table DML grants required for sync.

## Packaging
Copy into repo as `examples/demo-sessionly/` for FE (demo-only; may not merge to main).
