# 好好上課｜唯一維護中的網站前端（路徑 v2/）

> **給 Codex 和其他 AI：** `v2/` 是正式 Vercel 網站的現行前端。此資料夾保留早期命名，**不是已退役的 V2 網站**。先閱讀根目錄 `AGENTS.md`。

## 對應服務

- 正式網站：https://tutor.rapid4grad.com/
- GitHub：https://github.com/zhichiangai/tutor-app
- Vercel：`tutor-app-v2`，部署來源 `main`
- Supabase：`vctisuglfoxyuwlvyjee`，Google OAuth + PostgreSQL + RLS/RPC
- Root route：`vercel.json` 將 `/` rewrite 到 `/v2/index.html`。

## 正在維護的前端檔案

- `index.html`：單一頁面結構、老師／家長／學生模式
- `app.js`：狀態、登入、學習紀錄、付款與排課整合
- `style.css`：桌面／手機介面
- `calendar-view.js`、`scheduling.js`：日曆、固定排課、單堂改期與補課規則
- `lesson-actual.js`：實際上課時間與時數
- `payment-ledger.js`、`payment-correction.js`：應收與付款／更正呈現
- `v4-connections.js`、`v4-contacts.js`、`v4-config.js`：V4 邀請、連結和設定

## 使用者及權限

- 老師：工作空間、課程、課後內容與收款確認。
- 家長：與已連結學生共享課表、查看學習內容、付款申報。
- 學生：與已連結老師共享課表及學習內容；**不可讀取學費、時薪或付款資料**。
- 瀏覽器上切換角色不代表取得授權；資料讀寫必須使用 Supabase Auth、RLS、受控 RPC 查驗關聯。

## V4 注意事項

- V4 Draft PR #43 未通過正式資料庫發布 Gate；Production Schema 仍與分支候選 SQL 有落差。
- CI 隔離環境完成的付款及瀏覽器測試不等於正式登入／真人 UI 驗收。
- 不得在正式站使用假課程或付款做測試。
- 不要重啟或清除未經授權的 Mac Docker Volume。
- V4 通知的 GAS 程式位於 `integrations/google-apps-script/v4-notifications/`，仍屬有效整合。
- 詳細發布條件參閱 `docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md`。
