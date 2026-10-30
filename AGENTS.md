# Codex / AI agent guidance — 好好上課 tutor-app

## Canonical app — mandatory

- **ONLY maintained frontend:** `v2/index.html`, `v2/app.js`, `v2/style.css` and supporting files under `v2/`. The directory name **v2 is historical**; it hosts the current V3.5/V4 frontend.
- **Production URL:** https://tutor.rapid4grad.com/ ; **only** Vercel project `tutor-app-v2` from GitHub `main` is the official deployment.
- **Production backend:** Supabase `vctisuglfoxyuwlvyjee`, Google OAuth and PostgreSQL RLS/RPC.
- `vercel.json` rewrites `/` to `/v2/index.html`. Root `index.html` is merely a redirect fallback, not an alternative application.
- The retired GitHub Pages V1 timer + GAS/Sheets implementation is **not** a supported application. Do not recreate or deploy the deleted former `frontend/`, `backend/apps-script/`, or V1 entrypoint, even if seen in older branches, cached files, or Git history.
- **Keep** active V4 notification implementation at `integrations/google-apps-script/v4-notifications/` and `supabase/functions/v4-gas-bridge/`. It is not the retired GAS database.
- **Keep** all `supabase/migrations/` historical files, regardless of old-looking version names. They are required for isolated database replay and schema analysis.

## Release gate and branch discipline

- V4 is being developed in Draft PR #43: https://github.com/zhichiangai/tutor-app/pull/43 . Verify its HEAD before editing.
- **DO NOT** merge to `main`, deploy Production, execute Production SQL/migrations, loosen RLS, or alter real student/payment records without explicit authorization.
- Production migration history is 29 as of the read-only 2026-10-29 snapshot. Repository replay baseline and V4 candidates differ: read [docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json](https://github.com/zhichiangai/tutor-app/blob/chat/v4-release-integration-20261029/docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json) and [docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md](https://github.com/zhichiangai/tutor-app/blob/chat/v4-release-integration-20261029/docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md). **NEVER** blindly run `supabase db push` or `supabase migration repair` on Production.
- Run Node tests: `node --test tests/*.mjs`; verify isolated Postgres + real Chromium GitHub Actions separately.
- Preview READY does not mean an isolated test database exists. Only perform fake lessons/payments in a verified isolated staging backend.
- GUI validation requires actual Browser Use or Computer Use tools; don't label API/Playwright automation as live manual browser testing.
- For Mac local QA, review [docs/qa/V4_MAC_LOCALHOST_BIND_RECOVERY.md](https://github.com/zhichiangai/tutor-app/blob/chat/v4-release-integration-20261029/docs/qa/V4_MAC_LOCALHOST_BIND_RECOVERY.md); never reset/recreate a volume without approved backup and impact analysis.

## Roles and privacy

- Teacher, parent and student share authorised schedules; authorisation must come from **current DB links/RLS**, never just a UI-selected role.
- Students must never receive payment values or hourly rates.
- After guardian unlink, former parents must lose access to historical linked payment records, including with the same valid JWT.
- Keep real account credentials, sessions, tokens and student/financial records out of source control, comments, screenshots and AI replies. Local account role references may be git-ignored; do not infer missing secrets.

## Where to read next

- `README.md`: single source of truth for site architecture and release state.
- `v2/README.md`: active frontend file map.
- [docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md](https://github.com/zhichiangai/tutor-app/blob/chat/v4-release-integration-20261029/docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md): production NO-GO and migration release gates.
- Old `docs/v*.md` files describe historical changes or security rules, not an alternate active frontend.
