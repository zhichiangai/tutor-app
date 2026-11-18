# V5.8｜Google Drive 同 OAuth App 建立合成資料夾：獨立 Main 測試發布 Gate

日期：2026-11-18（Asia/Taipei）；狀態 **DRAFT / NO PROD / NO MAIN MERGE WITHOUT SEPARATE APPROVAL**。

本獨立測試 PR 從 GitHub Main 8cf48e3bfcd0f11638db3141bcf47d89e11e94fe 建立，**不包含** PR #83 所屬的 V5.8 Migration/發布鏈。只提供 Google Drive 最小 OAuth 操作驗證。

## 背景（Codex GUI 交接，尚未經由工具讀取 Secret 值）

使用者與 Codex 已在 Google Cloud 建立 tutor-app-backup 專案、啟用 Drive API、External Testing OAuth 應用程式與 drive.file scope，並在 GitHub Environment v58-gdrive-synthetic 建立三個 Secrets：

- V58_GDRIVE_CLIENT_ID
- V58_GDRIVE_CLIENT_SECRET
- V58_GDRIVE_REFRESH_TOKEN

這些 Secrets 是否正確尚未實測，任何 Secret/Refresh Token 值絕不可放 GitHub Repo、聊天、日誌或截圖。

原 PR #83 的 v58-gdrive-synthetic-oauth-roundtrip.yml 尚未合併 main，所以 GitHub Actions 顯示「This workflow does not exist」是符合預期的狀態。只有 Default Branch 中存在 workflow_dispatch，才能在 Actions UI 啟動。

## 獨立安全範圍

此 PR 只新增：

1. scripts/release/v58-gdrive-synthetic-roundtrip.mjs
2. tests/v58-gdrive-synthetic-roundtrip.test.mjs
3. .github/workflows/v58-gdrive-synthetic-oauth-roundtrip.yml
4. 本文件

完全沒有 Supabase 連線、正式 SQL、登入資料、Vercel 部署 API、Migration 或刪除 Drive API。GitHub Job 設定 contents: read；在 PR 中執行的 mock-contract-no-secrets 完全不取得 Environment Secrets。持有 Google Secrets 的 protected-manual-synthetic-drive Job 僅在 main + workflow_dispatch + SYNTHETIC_ONLY 選項時執行。

**注意**：即使只有這幾個檔案，合併 main 也可能觸發 Vercel Production 自動部署。沒有額外明確授權前不得合併。

## 合成測試執行步驟（僅在獨立授權合併 MAIN 後）

1. 確認 v58-gdrive-synthetic GitHub Environment **只允許 main**，三個 Secret 名稱存在並由使用者安全輸入。可以另依安全需求設定 required reviewer，但這會阻止無人值守自動執行；目前只做**手動合成測試**。
2. GitHub Actions 選 V5.8 Drive OAuth synthetic-only isolated gate，選 main / safety_ack=SYNTHETIC_ONLY / operation=BOOTSTRAP_FOLDER。
3. 工作將用**同一專用 OAuth App 的 refresh token**呼叫 Drive API files.list；如果該 App 看不到專用資料夾，會建立私有的 tutor-app-v58-synthetic-only 資料夾，不會使用原 ChatGPT Connector 建立的資料夾，也不會刪除任何現有檔案。
4. 驗證 Job 輸出 SYNTHETIC_FOLDER_READY；從受控的執行日誌複製不含憑證的 folder_id。若有不只一個符合的資料夾、Token 無效、授權權限不足，一律 FAIL 並停止。
5. 由使用者或 Codex 在 GitHub Settings → Environments → v58-gdrive-synthetic → Environment Variables 建立 V58_GDRIVE_SYNTHETIC_FOLDER_ID，填上該 id。Folder ID 不是 Client Secret，但不要公開分享到無關人員。
6. 再於 Actions 選 main / safety_ack=SYNTHETIC_ONLY / operation=SYNTHETIC_ROUNDTRIP。它只生成一次性虛構文字及短暫 age keypair，age 加密後才上傳該 App 可讀寫的合成資料夾，下載密文 SHA 比對，使用一次性私鑰解密並 cmp 校驗。**不是**正式 DB 備份。
7. 任何失敗都只記錄無敏感訊息的 FAIL；請不要將 CI 日誌原文、Secrets、Token 提供 AI。可回報 Status、Run ID 與無憑證的最後幾個步驟。

## Testing Refresh Token 有效期

Google External + Testing 的 Refresh Token 通常約 **7 天**到期；這只能當短期合成整合測試。正式每日無人值守前需另行審查是否符合 Google Workspace Internal 應用程式條件，或進入 External In production／必要驗證程序；任何改變 OAuth 發布狀態都需使用者批准。不要靠重複手動換 Token 當作長期備份服務。

## 本 PR 不會做的工作

- 不合併 PR #82 或 #83，不執行 Migration 63。
- 不接觸 Supabase Production，沒有任何 Production dump。
- 不啟用每日排程，不建立完整 7／4／6 清理作業。
- 不刪除任何 Drive 備份，不把真實資料／age 私鑰上傳 GitHub。
- 不代表 Google Drive 的真實授權、PG17 合成 dump + 真實 Drive + 隔離 restore 或正式 Supabase 還原已 PASS。

完整後續設計仍由 PR #83 的備份文件維護，這個獨立 PR 只解決 OAuth App 可自建資料夾的最小合成測試啟動問題。
