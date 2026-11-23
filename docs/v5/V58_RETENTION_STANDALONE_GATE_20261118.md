# V5.8｜Google Drive 7 日／4 週／6 月備份保留：獨立安全 Gate

日期：2026-11-18。**狀態：DRAFT / READ-ONLY PLAN / NO DRIVE DELETE / NO PRODUCTION。**

本獨立 PR 從 main 基礎切出，重用 PR #83 已通過合成測試的保留策略與測試檔；目的在於讓此安全元件可以獨立審查，不必把 V5.8 Migration 63 或正式發布程式一起合併。

已確認的產品需求：
- 最新 7 個不同 UTC 日期代表版本
- 最新 4 個 ISO 週代表版本
- 最新 6 個 UTC 月份代表版本
- 三類取聯集；Migration 前備份與人工 Hold 額外保留
- 缺少成功上傳校驗或真正隔離資料庫還原證據時，全部保留
- **此階段永遠不刪除 Google Drive 任何檔案**

## 本次實作與測試

- scripts/release/v58-gdrive-retention-plan.mjs：只讀取離線 JSON Catalog，不接受密碼、不連接 Google Drive、不操作 Supabase；輸出 KEEP / REVIEW_FOR_RETIREMENT（僅人工審查候選）
- tests/v58-gdrive-retention-plan.test.mjs：保留數量、重要備份永不淘汰、驗證失敗 Fail-Closed、格式及專案 ID 驗證
- .github/workflows/v58-gdrive-retention-offline.yml：PR 合成單元測試，沒有 Secrets、網路外部 API 或破壞性操作

只有「最近 36 小時有驗證成功的加密上傳」且「45 天內有**真正隔離還原**成功」時，工具才會列出人工審查的退休候選；即使工具列為候選也不會真正刪除。已定義的 7+4+6 是不同日期／週／月代表版本，重疊會去重，實際副本數未必 17 份。

## 接下來仍要做什麼

- 讀取 Google Drive 真實版本 Catalog 並安全地校驗歷史備份的來源、加密、雜湊、上傳完成時間與還原證據；目前沒有這個整合。
- 每日正式排程與失敗通知：尚未開啟，也未取得正式 DB 憑證授權。
- 若未來真要刪除舊備份，先完成版本保護、最低保留份數、獨立金鑰復原與使用者當次明確授權；**不可因為通過離線測試就自動開啟刪除**。
- OAuth 長期授權與真正 PG17 archive → 真實 Drive → 隔離還原，與本 PR 獨立處理。
- 不執行 Supabase Migration63、任何 Production DB 讀寫或自動 Main 合併。

此 PR 仍應維持 Draft，合併 main 時 Vercel Production 可能自動部署，需當次分開授權。
