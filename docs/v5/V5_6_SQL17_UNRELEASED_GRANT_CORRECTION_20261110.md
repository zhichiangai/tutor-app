# V5.6 SQL17 Draft source correction — 2026-11-10

This is a GitHub **Draft PR #68** correction prior to any Production deployment or migration. The V5.6 forward migration `20261110080000_v5_6_manager_adjustment_sources.sql` initially ended with an incorrect **three-argument** GRANT EXECUTE signature for the existing **four-argument** `public.v56_request_team_credit_refund(uuid,bigint,text,text)`.

## Isolated CI evidence
- Failed disposable Supabase migration replay at SQL17; PostgreSQL SQLSTATE **42883**, function `public.v56_request_team_credit_refund(uuid,bigint,text)` not found.
- Corrected only the GRANT to `(uuid,bigint,text,text)` in the never-deployed SQL17 Draft file; historical SQL9–16 unchanged.
- Old SQL17 Git blob SHA: `4011443e97c1d82df78d1350d0216b8a782a9c8d`, 16,183 bytes.
- New SQL17 Git blob SHA: `3da6fa71101bc705be3188163e745241cefe31ab`, 16,188 bytes.
- Updated pending source-lock catalogs #17 and #18 with exact corrected bytes; these Draft catalogs have **never** authorized Production migration. Previous catalog revisions remain in Git history for audit.
- Post-fix disposable GoTrue/JWT/Chromium CI must be independently confirmed on latest Head before claiming PASS. A1-R3 formal 43-history compatibility remains BLOCKED.

No Main merge, Production SQL/RLS/Auth change, paid branch, real-data QA, bank refund or production deployment was performed.
