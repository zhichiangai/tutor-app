# 好好上課 V4｜P0 家長 NT$600 付款回報失敗：本機診斷與驗收

**狀態：FAIL / BLOCKED，未修復。** 2026-10-29 Codex 的 PR #43 本機三角色 E2E：老師、家長、學生合成帳號可以登入；家長在 2026-10 月期間回報 NT$600，按確認後收到「儲存未完成」，本機沒有新增付款批次。此報告不包含當次 RPC 的實際錯誤碼或錯誤文字。禁止將它當成正式帳務已修復。

## 已核實的程式差異（**候選根因，不是定論**）

- `v2/app.js > submitPeriod` 透過 `client.rpc('submit_range_payment',...)` 提交付款，錯誤會經 `persist > readableWriteError` 顯示並輸出到 Console。資料庫端若拒絕交易，前端會回報失敗且沒有新增批次。
- `v2/payment-ledger.js > lessonAllocation` 會依 `qaBatchIds` 忽略模擬付款，依 `qaLegacyReceiptLessonIds` 忽略標記為模擬的舊式直接收款，因此前端可能呈現「尚可付款」。
- 2026-10-29 透過**唯讀** SQL 檢查正式資料庫中的 `tutor_private.submit_range_payment`，其函式版本仍用所有 `pending`／`confirmed` batch items 保留金額，並排除 `lesson_records.status in ('老師已收到','家長已付款')`；查到的函式沒有 QA 分類過濾。
- **本機 36 migrations 重播後的實際函式須再次確認**：本機和正式 SQL 可能已不同，不可單憑正式函式下結論。
- 計算差異範例（僅舉例）：一堂總額 NT$1,000 的真實課程有已確認的 QA 批次 NT$1,000，前端將 QA 批次排除後顯示可付款 NT$1,000，原本 backend 卻可能認定全部已分配。當家長要回報 NT$600，即會收到「No eligible unpaid lessons for this period」或其他拒絕。**尚無實際 Network 回應證實是哪一種。**

### 另有獨立觀察

本機課程日期 10/28、10/29 顯示不同，應獨立檢查資料庫 `date` 與瀏覽器 `Date` 解析。不要直接修改歷史日期或在無證據時將日期問題當作付款失敗根因。原版 `submit_range_payment` 的付款日期檢查使用 `Asia/Taipei`，仍以本機函式為準。

## Codex 只讀診斷（保留 21 個本機合成 Auth 帳號）

1. 確認目前工作樹、branch、服務均為 PR #43 + `tutor_v4_isolated`、`http://127.0.0.1:54321`、`127.0.0.1:54322`；保留現有資料，**不 reset**。
2. 使用家長**既有合成帳號**登入本機網站。若需要本機臨時登入橋接，只允許 `127.0.0.1` 且不提交密鑰。Chrome／Codex DevTools Network 開啟 `Preserve log`，只進行**一筆** NT$600 測試回報，不用真實金錢，避免多次提交造成未知狀態。
3. 找 `POST /rest/v1/rpc/submit_range_payment`；記錄 HTTP status、PostgREST `code`、`message`、`details`、`hint`。**不要複製 Authorization、apikey、cookies、JWT、密碼、完整學生／交易 UUID。**
4. 查本機是否真的沒有新 batch；若 response 是 2xx 但 UI 顯示失敗，定位 `refreshLive` 與資料讀取／重渲染，不能再發一次請求。
5. 只在本機 docker `supabase_db_tutor_v4_isolated` 上執行 `tests/sql/v4_parent_payment_p0_readonly.sql`，回報五個聚合欄位、兩個函式 QA 規則布林值。不可在正式資料庫或 RAPID 的專案執行。
6. 若 SQL 顯示保留額差異或 status gate，不直接修改正式 SQL；先建立**額外合成課程**的精確重現，隔離測試提交成功／失敗的條件。必要修補由 ChatGPT 程式端提出新候選 Migration 並驗證前後結果。
7. 若 HTTP 為 401/403，優先檢查家長 JWT、guardian link 和 RPC EXECUTE 權限；若 PGRST202 檢查 RPC signature/schema cache；若 P0001 檢查函式自訂拒絕原因；若 5xx 檢查局部容器服務。不要用管理員密鑰直接替家長付款。
8. 成功或失敗，最後停止測試動作，留下既有容器及本機測試資料供確認。

## 修補完成才可宣稱 PASS 的關卡

| 項目 | 驗收證據 |
| --- | --- |
| 本機家長 NT$600 部分付款 | 單次 RPC 返回成功；只新增一筆 pending batch；分配金額總和 600 |
| 模擬付款及真實付款隔離 | QA 分配不被當作真實銀行入帳；真實應收／已收／待收一致；不可產生重複收款 |
| 權限 | 家長只提交已連結學生；其他家長、學生、匿名不可冒用；老師確認和更正具 RLS／RPC 保護 |
| 解除連結 | 解除後同一舊 JWT 與舊 batch UUID 的 REST 查詢為拒絕或空列，不能只看 UI |
| 更正／沖銷 | 老師更正後 Ledger 淨額正確，且不可覆寫歷史；冪等與併發安全 |
| 課程 CRUD | 新增、改期、單次取消、未來取消、固定課表至少完成本機資料測試 |
| Google OAuth | 仍須獨立 Staging／正式授權測試，localhost email/password 不足以驗證 |

**正式發布 NO-GO：** 不合併 main、不部署 Production、不改正式 Supabase、不匯入真實資料、不重設／刪除現在 21 個合成帳號。
