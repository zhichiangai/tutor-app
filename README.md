# 好好上課（tutor-app）｜唯一維護中的家教網站

**正式網站：** https://tutor.rapid4grad.com/v2/index.html  
**GitHub：** https://github.com/zhichiangai/tutor-app  
**正式來源：** GitHub `main` → Vercel `tutor-app-v2` → Production  
**專案規範：** [AGENTS.md](AGENTS.md)；若有使用者專案知識 `AI_DEVELOPMENT_MASTER_RULES.md`，也要先閱讀。

> `v2/` 是現行正式前端，名稱是歷史沿用，不代表目前使用舊版 V2。所有即時狀態須以 GitHub、Vercel、Supabase 實查為準，本頁的版本資訊只是有日期的快照。

## 現行架構

```text
老師／家長／學生
  → tutor.rapid4grad.com
  → Vercel tutor-app-v2（main 自動部署）
  → v2/index.html、v2/app.js、v2/style.css 與 V4/V5 支援模組
  → Supabase vctisuglfoxyuwlvyjee（Google OAuth、PostgreSQL、RLS/RPC）
```

- `vercel.json` 將網站根目錄 rewrite 至 `/v2/index.html`。
- 個人家教 V4：課表／課後學習／家長帳務／角色連結與帳務更正。
- V5 Free／Plus／Team：方案介紹與前端模式切換已存在；內部 Plus 仍使用 `pro` 方案代碼以相容既有設計。
- Team 專案、老師權限、學生、課表、應收、部分付款、預收、對帳與營運摘要：在 repo 的十份 V5 Migration 與隔離 CI 有開發成果，但**正式 Supabase 尚未套用 V5 Migration，不代表 Team 正式可用**。
- `supabase/functions/v4-gas-bridge/` 和 `integrations/google-apps-script/v4-notifications/` 為仍需保留的有效整合程式；是否已在正式環境部署或寄送須另外查證。

## 已核對的正式版本快照（2026-11-09，請現查）

- PR [#66](https://github.com/zhichiangai/tutor-app/pull/66) 已合併，Main／Production SHA：`5b147cb19563d9ee75b71bbcab7f2d06a22e4794`；Vercel Deployment：`dpl_2fWTgxCQw465LSBFiU6WqpiUtGe3`（READY）。
- 正式 Supabase：43 筆歷史 Migration，最新 `20261103212647`；未啟用 V5 Team Schema/RPC。
- 開發中的 [Draft PR #67](https://github.com/zhichiangai/tutor-app/pull/67) 聚合學生用詞、三角色 RWD、學習備註 UX 與整合 QA。**未合併 Main，不應當成已上線功能**。
- V5 正式資料庫 Gate 仍為 **NO-GO**：尚未對「真實 43-history Schema-only 隔離副本」依序演練 10 筆向前 Migration（A1-R3 BLOCKED）。乾淨 CI 重播 47 份原始 migration 無法取代。
- 既有假資料是否可以清理與實際清理範圍需要另行授權；不能因資料是 QA 就自行刪除使用者或付款紀錄。

詳見 [V5.7 十份 Migration 安全 Gate](docs/v5/V5_7_A1_TEN_MIGRATION_RELEASE_GATE_20261109.md) 與 [前端模組圖](v2/README.md)。

## 開發與驗收分工

- ChatGPT：需求、雲端程式、GitHub Branch／PR／CI、Vercel／Supabase 與 RLS 安全、發版閘門。
- Codex Desktop：在 Mac 讀取既有交接 MD、使用 **@瀏覽器** 實測老師／家長／學生操作、真實可支援的手機尺寸、登入登出、截圖與缺陷交接。Codex 不負責日常雲端程式改寫或正式部署。
- 先在分支跑 `node --test tests/*.mjs` 和 GitHub Actions 隔離 Postgres／Chromium。**Playwright PASS 不等於 Production GUI PASS**。
- Production 網站唯讀；不能在正式站新增／修改／刪除學生、課程、帳務、Team 權限或送出真實訊息來做 QA。
- Main 合併、Production SQL/RLS/Auth、金流及不可逆操作需要各自當次授權。
- CI 判定統一使用 PASS／FAIL／PARTIAL／BLOCKED／NOT TESTED；未實測不宣稱 PASS。

## 其他重要規則

- 歷史 SQL、現行 GAS 通知程式不可因舊檔名擅刪。
- 已退役的舊版 GitHub Pages `frontend/` 與 `backend/apps-script/` 不可當成正式入口恢復。
- Mac 的本機 AI 交接與 `TEST_ACCOUNT_ROLES.md` 由具有本機檔案存取的 Codex 查閱，**不要**把測試密碼、Token 或完整個人資料寫到公開 PR 或截圖。
