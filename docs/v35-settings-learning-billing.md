# V3.5 正式產品設定、課後紀錄與付款資訊

## 發布內容

- 正式站 https://tutor.rapid4grad.com/ 只顯示 Google 登入；不再提供未登入互動預覽按鈕。原本瀏覽器內的歷史測試資料未刪除，前端不再載入。
- 「設定」獨立成網頁分頁：個人顯示名稱、我的家教空間名稱、角色與帳號、登出。
- 使用者勾選老師／家長／學生三個模式（至少一個）；上方切換僅顯示已勾選的模式。同一 Google 帳號的勾選結果存在 `profiles.enabled_roles`，並以 `roles_configured` 區分首次登入初始化與使用者手動偏好。**這只是顯示偏好，不是 Supabase 授權**；未獲學生或家長連結者仍無法查看課程。
- 老師完成上課時可同時記錄：實際時間及時數、`lesson_content`（上課內容）、`focus_rating`（專注度 1–5）、`mood_rating`（學生心情 1–5）、`remarks`（課後備註）。
- 已付款或進入付款流程的課程仍鎖定時間、金額與時數；老師只能透過獨立的 `update_lesson_learning` 更新非財務的學習欄位，並要求相符 `updated_at`。每次備註變動留在非公開 `tutor_private.lesson_feedback_audit`。
- 家長付款頁及選擇付款期間時，逐堂以簡潔排列顯示上課日期、科目、內容、專注度／心情、時數、應付或可付款金額；原本部分付款、已確認與待付款計算不變。
- 學生頁能看到老師留下的上課內容、專注度、心情與回饋，不回傳任何鐘點費、收款金額或付款批次。既有 `attitude_rating` 歷史欄位保留，不以心情星級覆蓋。

## Migration 與安全性

SQL 檔：`supabase/migrations/20261021181000_v35_roles_lesson_learning.sql`。

使用 SQL 擴充 `profiles` 與 `lesson_records`，同時更新只回傳學生學習資料的 `student_portal_data()` RPC。新的 `update_lesson_learning()` 為 `SECURITY INVOKER`，只有已登入者能呼叫，且使用 `owner_id=auth.uid()` 和原本 RLS 雙重限制；版本過期或非老師本人會拒絕。私有審計表不開放一般登入者讀取。

此 Migration 不變更或重算任何真實課程金額、付款批次或已收款紀錄，也不更改 Google OAuth 或 Supabase Auth 的密碼登入政策。

## 驗收

1. Node 回歸測試：`node --test tests/*.mjs`，確認舊版排課、權限、付款保護與 V3.5 新測試全部通過。
2. Supabase SQL：使用可 `ROLLBACK` 的測試交易，確認角色設定、星級約束、教師更新已付款課的學習欄位不影響金額，並確認家長與學生不可呼叫相同 RPC 來修改。
3. 使用三個獨立 Google 帳號實際測試：角色開關 → 頂部模式 → 跨裝置同步 → 家長付款明細 → 學生學習回饋；**不准使用真實付款紀錄做破壞性測試**。
4. 手機寬度 390×844、320×568，並盡量補測 iOS Safari；檢查五個底部導覽項目、星級點擊與付款列表的文字換行。
5. 已付款與未付款課程必須驗證不同儲存動作，後端不得因資料更新更動 `hourly_rate`、`hours`、`total_amount`、`payment_batch_items`。
6. 若沒有真人瀏覽器 E2E 證據，需標為待驗收，不能將 CI 通過當作真人通過。

## 已知限制

- 目前仍採重新整理同步，尚未實作即時推播。
- 暫未提供科目個別鐘點費設定表，計價規則沿用現有老師設定與課程歷史。
- `attitude_rating` 舊資料保留，V3.5 正式課後介面改顯示 `mood_rating`。
- Supabase Security Advisor 的必要 `SECURITY DEFINER` RPC 警告及外洩密碼防護仍須另行定期審查。
