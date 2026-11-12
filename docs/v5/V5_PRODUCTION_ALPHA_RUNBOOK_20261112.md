# V5.7 Production Alpha（僅內部免費驗收）受控發布

> 2026-11-12。**此流程不等於商業上線**。不收平台費、不執行自動銀行轉帳／退款。任何真實帳務與使用者資料不得清除。正式發布後再由 Codex 進行老師／家長／學生／Team IAB 驗收。

## 1. 發布版本與分層核准

- 原 V5 商業正式版 `docs/v5/V5_PRODUCTION_RELEASE_APPROVAL.json` 保持 `BLOCKED`。
- 原 19 筆 SQL source-lock 保持 `NO_GO`、SQL SHA／版號不變。
- **僅** `docs/v5/V5_PRODUCTION_ALPHA_APPROVAL_20261112.json` 記錄本次特定 SHA 的內部 Alpha 決策及未驗證的商業能力。
- 19 筆 SQL 的來源為 `release/v5-20261111`，固定 SHA `97ed121f68d3ffed40770d2c7141ec1c15b6f574`。
- Production Supabase `vctisuglfoxyuwlvyjee`；既有 43 migration → 預期 62。
- 必須先合併**僅包含受保護工具**的 Alpha gate PR 到 `main`，完成 Vercel V4 Production SHA / READY 查核；不得先合併 V5 PR #69。
- `V5_WRITE_ENABLED=NO` 維持至所有以下發行檢查通過，並經 Protected Environment Reviewer 核准單次 Alpha-apply。

## 2. 禁止與停損條件

- 不允許 `supabase db reset`、`migration repair`、全 Repo migration 直接推送、任何正式表的 TRUNCATE。
- 不開啟任何平台訂閱收費、付費方案自動扣款、外部銀行入帳／退款、電子發票。
- 既有課程付款欄位僅作**人工記錄**；不表示銀行已驗證。
- GAS 隔離 Worker 禁止接正式 Supabase；未驗證的獨立外部通知／金流系統維持停用，不加入 Alpha 測試。
- Preflight 對 43 份歷史／RLS／19 份 pending SQL 有任何差異即停止；任何 apply/job 失敗應先查 history，禁止直接重跑。
- 目前沒有證據證明 Production 備份完整還原。原測試資料可捨棄不等於可任意刪除，實際版本仍應保留 Audit／Migration History。
- Vercel Instant Rollback 只能退前端；**不會**退 PostgreSQL Schema。後端錯誤優先凍結新寫入、保留證據、審查 forward fix。

## 3. 執行順序

1. 新 Alpha gate PR 的完整 CI 成功並合併 Main；正式站仍維持 V4；新 Main 的 Vercel READY SHA 必須一致。
2. 檢查 GitHub Environment `v5-production-db`：
   - `V5_APPROVED_RELEASE_SHA=97ed121f68d3ffed40770d2c7141ec1c15b6f574`；
   - `V5_PRODUCTION_DB_URL` Secret 存在（不可顯示）；
   - `V5_WRITE_ENABLED=NO`，Required Reviewer 正常。
3. GitHub Actions `V5 protected Production database migration`，在 `main` 再跑一次 `preflight`；只允許 `verify-code` 與 `protected-migration` **真實成功**，而非 skipped。
4. 經上述確認，為**本次單一 Alpha 變更**由管理者調整 Environment `V5_WRITE_ENABLED=GO`。
5. 同一個 Actions Workflow 手動執行：
   - branch `main`
   - `release_sha=97ed121f68d3ffed40770d2c7141ec1c15b6f574`
   - `operation=alpha-apply`
   - `confirmation=ALPHA_APPLY_V5_19_97ed121f68d3ffed40770d2c7141ec1c15b6f574`
   - Protected Environment 不得繞過審核。
6. 必須看見 **apply success、62/62 history success、V5 RLS/匿名暴露 after-check success** 才能繼續；如 FAIL 則停止、不要合併前端。
7. 立即將 Environment `V5_WRITE_ENABLED` 恢復 `NO`，核對已儲存，不再進行第二次寫入。
8. 由 ChatGPT 合併 PR #69 至 Main，核對正式 Vercel `tutor-app-v2` READY，Main SHA、Production SHA、正式網域一致。
9. Codex 以已授權內部測試帳號在 `https://tutor.rapid4grad.com/v2/index.html` 逐一驗收老師、家長、學生、Team 多老師、多專案、權限、日曆、帳務、手機版。任何具有外部副作用的功能停用／跳過；正式 Production 操作必須使用使用者授權的 QA 帳號。
10. 對外邀請正式使用者之前，必須另行核准資料保護、對外通知、安全與商業化檢查。

## 4. 真正完成的條件

- GitHub Main / Vercel Production 同 SHA 且 READY；
- Supabase History 62，V5 schema/RLS/Postflight PASS；
- `V5_WRITE_ENABLED=NO`；
- Codex IAB 實測並產出 PASS／FAIL／PARTIAL／BLOCKED／NOT TESTED、截圖證據、角色分離及 UX 問題排序；
- 上述條件未滿足前，不宣告 V5 完整上線。
