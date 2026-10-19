# V2.6 穩定性與權限修補紀錄（2026-10-20）

## 範圍

這是 V2.5 的非破壞性維護版，**不增加新的操作功能、不改動課程彈窗、不改動付款週期，也不改動 V1**。
開始修補時，`main` 的 HEAD 為 `f0b4084ac223c5f175b84af98ebdc337aac74b8a`，包含 Google OAuth SDK 路徑修正、隱私權政策及服務條款。

## 已處理

### 正式 Supabase（Project `vctisuglfoxyuwlvyjee`）

1. 移除 `recurring_schedules` 的 `USING(true)` 讀取政策，老師與家長只能讀取有授權關係的排課。
2. `student_guardians` 接受邀請時，必須同時比對邀請 ID、老師 ID、學生 ID、已驗證登入 Email 與 `auth.uid()`。
3. `family_requests` 申請必須指向同一位授權學生及老師；固定課表請假日期須符合週期，已完成課程的時間更正只允許正確課程類型。
4. 合併 `lesson_records` 重複的 SELECT RLS 政策；調整 JWT 取值，避免重複計算效能警告。
5. 補齊先前提示的 13 組外鍵索引，保留既有未使用索引（不因測試流量少就擅自刪除）。
6. 移除 `authenticated` / `anon` 不必要的 `TRUNCATE`、`TRIGGER`、`REFERENCES` 權限。尤其 `TRUNCATE` 不受 RLS 列政策保護。
7. 家長請假／時間更正的 `family_requests` 正式更新權限只保留給審核流程所需的 `status`、`reviewed_at` 欄位。
8. 加入刪除防護，避免已付款／已收款或有付款申請與分配紀錄的課程直接被刪除。
9. 將原本已透過 SQL 加到正式環境、但未被記錄在 migration 系統中的 V2.5 實際上課時間欄位與函式，補入可重播的 schema migration。

### 網站前端

1. Supabase 讀取改為每次 500 筆、依主鍵穩定排序並分頁讀取；不再固定只拿前 1,000 筆。
2. Google 使用者切換或登出時防止較早啟動的讀取結果覆蓋其他登入身分資料。
3. 儲存成功後即使畫面重新整理失敗，也不會誤報「儲存失敗」；提供重新整理提示。
4. 保留原本就被停用的送出按鈕狀態，不因短暫儲存完成被誤啟用。
5. 不改變任何現有按鈕、老師／家長權限設計、實際計費計算或付款互動。

## 程式碼與可重播 migration

- `supabase/migrations/20261020023000_v25_actual_lesson_baseline.sql`
- `supabase/migrations/20261020023100_v26_rls_hardening_and_indexes.sql`
- `supabase/migrations/20261020023200_v26_limit_browser_table_privileges.sql`
- `supabase/migrations/20261020023300_v26_guard_paid_lesson_deletion.sql`

上方版本檔案用於新環境重播（需按既有 V2.3 migration 之後的順序執行）。正式 Supabase 歷史中，修補 SQL 是分批套用的，版本名稱／時間戳不完全相同，但目標最終狀態應一致。不得把上述 SQL 再當成需要對正式環境重複執行的待辦。

## 測試指令

在專案根目錄執行：

```bash
node --test tests/v2-regression.mjs
```

Supabase SQL Editor 可以唯讀執行：

```sql
-- 請執行 supabase/tests/security_assertions.sql
```

本次已以隔離的 JS 模擬環境測試：預覽使用者完成課程、1.2 小時計費、資料儲存、原本停用的按鈕保持停用，以及 1,201 筆學生和 1,100 筆付款分配的多頁讀取。

在正式 Supabase 執行的唯讀 SQL 稽核已通過；另使用 transaction-local authenticated 角色模擬驗證：沒有授權的使用者看不到現有學生，而擁有者可讀取自己的學生。**尚未以兩個真人 Google 帳號完成瀏覽器端對端操作測試。**

## 剩餘事項（不在此非破壞性修補範圍內）

- Supabase Security Advisor 仍可能提示 `auth_leaked_password_protection`。網站以 Google OAuth 登入，是否啟用 Supabase Email/Password 防護應由管理者檢查 Authentication 設定，不要自行更改已可用的 OAuth。
- Supabase Performance Advisor 對「未使用索引」可能有資訊性提示，目前流量與資料筆數很少，不應自行刪除原索引。
- 家長邀請目前只建立資料庫邀請紀錄，不會自動寄信；屬於未來新功能。
- 完整課程變更歷程、手機與桌面人工 E2E、老師與家長雙帳號 E2E、V1 Sheets 資料轉移與備援演練都仍需後續規劃。
- 本版沒有改動 Google Cloud OAuth 設定、Google Sheets、GAS 或 V1 網址。
