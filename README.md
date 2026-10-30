# 好好上課（tutor-app）｜唯一維護中的家教網站

**正式網站：** https://tutor.rapid4grad.com/  
**原始碼：** https://github.com/zhichiangai/tutor-app  
**V4 發布候選：** [Draft PR #43](https://github.com/zhichiangai/tutor-app/pull/43)（尚未合併／發布）。

> **Codex／其他 AI 請先讀 `AGENTS.md`。** 程式庫內僅 `v2/` 是正在維護的網站前端。資料夾名稱 `v2` 是歷史命名，不代表目前要維護舊 V2。

## 唯一正式架構

```text
老師／家長／學生
  ↓ https://tutor.rapid4grad.com/
Vercel (tutor-app-v2, Production ← GitHub main)
  ↓ vercel.json: / → /v2/index.html
v2/index.html + v2/app.js + v2/style.css + v2/其他模組
  ├─ Supabase Auth (Google OAuth)
  └─ Supabase PostgreSQL (課程、三角色關聯、付款、RLS、RPC)
```

- **正式前端：** `v2/`（原生 HTML、CSS、JavaScript）。
- **正式資料庫：** Supabase `tutor-app`（ref `vctisuglfoxyuwlvyjee`）。
- **線上部署：** Vercel 專案 `tutor-app-v2`，從 GitHub `main` 發布。
- **V4 Edge Function：** `supabase/functions/v4-gas-bridge/`。
- **V4 通知整合：** `integrations/google-apps-script/v4-notifications/`。這是有效的 V4 整合，**不要當作舊後端刪除**。
- **資料庫歷史與 V4 變更：** `supabase/migrations/`、`supabase/hotfixes/`、`supabase/candidates/` 等；歷史 SQL 即使包含 V2 名稱，也必須保留，不能依檔名刪除。

## 舊版已從候選程式樹退場

原 GitHub Pages「家教時數帳本」的 `frontend/`、`backend/apps-script/`、兩份過時 legacy README 已移出目前候選分支，防止 AI 讀錯入口。根目錄 `index.html` 僅保留為安全轉址；舊 GitHub Pages 根網址應導向正式網域。

**這不代表 Git 歷史或 GitHub Pages 設定自動刪除。** Git 歷史用來追溯，GitHub Pages 發布是否停用需到 GitHub Settings → Pages 個別確認；不可把仍存在的舊部署視為可繼續操作的正式版本。

## 目前發布狀態與安全原則

- `main` 為 Production 的唯一來源；Draft PR #43 仍在 V4 驗收。
- 正式 Supabase 在 2026-10-29 的基線為 29 筆 Migration；PR #43 的 37 份本機重播與候選 SQL **不可**直接 `db push` 到 Production。
- 正式付款 RLS 有 P0 待修，正式備份及隔離還原、Google OAuth 實機驗收尚未證明完成；V4 不得僅憑 CI 綠燈視為已正式安全發布。
- **不得**在正式 Supabase 建立假學生、假課程或測試付款；不可在未授權情況下合併 PR、套 Migration、修改真實資料。
- 目前以 GitHub Actions 中的一次性隔離 Supabase 進行 Node/Postgres/Chromium 自動測試；Preview 只有前端 READY 並不代表具備獨立測試資料庫。
- 詳見 `docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md`、`docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json`、`docs/qa/V4_MAC_LOCALHOST_BIND_RECOVERY.md`。

## 開發與驗收

1. 先讀 `AGENTS.md` 和 `vercel.json`，只修改 `v2/` 的活躍網站。
2. 以功能分支與 PR 開發，不直接在 Production 嘗試 Migration。
3. 在隔離 CI 跑 `node --test tests/*.mjs`、Postgres Contract、Chromium Playwright。
4. 使用具備 Browser Use 權限的工具驗收老師、家長、學生，並區分唯讀正式站、隔離測試站、CI 自動化結果。
5. V4 經正式備份／還原、RLS、Migration 對照與使用者授權後，才能發布至 Production。

現行功能說明：[`v2/README.md`](v2/README.md)。專案歷次 V3/ V4 架構說明存放於 `docs/`，屬設計與回歸記錄，不代表仍有多套正式前端。
