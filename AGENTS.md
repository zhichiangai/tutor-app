# Codex / AI agent guidance — 好好上課 tutor-app

## Fixed ChatGPT × Codex responsibility split (user-approved)

- **ChatGPT conversation owns ALL engineering work:** task creation, product/code changes, GitHub branches/PRs, Supabase, Vercel, migrations, isolated environments, release preparation and programmatic tests.
- **ChatGPT must verify code first:** require relevant regression, SQL/RLS/JWT, API and CI tests to PASS or disclose BLOCKED before handing a task to Codex. Lock the exact PR, 40-character SHA, deployment URL, permitted actions and test backend.
- **Codex owns ONLY interactive UI QA with Codex Desktop's own internal browser (IAB):** actually read, click, type and capture screenshots. Never substitute Playwright, curl or a queued open-tab request for verified human-like IAB interaction.
- **Codex does not write site code, use Terminal/Docker for development, operate Supabase/Vercel/GitHub, deploy, or repair environments** in normal QA tasks; route those issues back to ChatGPT.
- **If IAB tools are missing:** report `IAB BLOCKED`, with the exact capability/error, without guessing the website failed. Do not repeatedly send open-tab commands or modify the app to fix desktop-tool availability.
- **After each QA round:** Codex provides PASS/FAIL/BLOCKED with reproducible steps, screenshots when possible, exact version and a complete copy-paste prompt for ChatGPT. ChatGPT owns the next fix/test round.
- **Production data is never a staging fixture.** Preview READY is not proof of isolated Supabase. Before IAB write tests, ChatGPT must explicitly verify a dedicated isolated backend. Production and real data are read-only for QA.
- **Releases are separate from QA:** main currently deploys Production; merging, production migrations/RLS, payments and any real-data changes require a separate safety gate and explicit user approval. CI or Codex PASS alone does not authorize a release.

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
- ChatGPT handles any isolated test-environment recovery; preserve volumes/data and never reset without a verified backup and explicit approval. Codex does IAB only.

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
