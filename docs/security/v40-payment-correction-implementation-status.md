# V4 已確認付款批次更正 — 本機整合驗收

> **DRAFT。沖銷寫入僅在隔離的 V4 測試後端啟用；尚不得合併正式 main 或套用正式資料庫。**

## 已完成的程式（本 PR）

- `payment_batch_corrections` 和 `payment_batch_correction_items`：獨立更正紀錄／逐堂金額表，僅開放 RLS SELECT，不賦予任何瀏覽器 INSERT/UPDATE/DELETE。
- 不可變更 Trigger 拒絕直接修改或刪除已存在的更正紀錄。
- 使用有效學生＋老師＋workspace 連結，保護家長讀取更正歷史；老師保留本人查閱權。
- `v4_payment_correction_preview(uuid)`：限老師本人讀取已確認批次，只返回原始分配、已更正、淨額；回傳 `can_apply=false`。
- 老師付款歷史增加 **查看可更正金額（唯讀）**，只在已連線的隔離 V4 開發／測試環境顯示。
- `v2/payment-correction.js`：整數分金額驗證及兩堂課、多筆部分更正的純函式規劃工具。
- Node 靜態／計算測試；**不是資料庫 JWT 或完整 E2E 測試**。

## 2026-10-24 本機後續實作

- 新增 `20261024050000_v40_apply_payment_corrections.sql`：僅原老師可更正已確認批次；逐堂、總額、原因、冪等與並行驗證；原始收款不可變。
- 校正 `submit_range_payment`、`review_range_payment`、課程狀態 Trigger，使用一次性交易內授權而非放寬直接 UPDATE；前端帳本與月總計採淨額。
- 老師更正視窗包含逐堂上限、原因與第二次確認；完成後原額／更正／淨額及歷史可見。家長僅在有效學生連結下可讀更正；學生端不讀帳務。
- 新增 `20261024053000_v4_contact_outgoing_tracking.sql`：不論 Email 是否存在都產生相同待處理回執；可撤回、到期、重新邀請；不授予課程權限。
- 乾淨本機 Supabase 重播 36 筆 Migration；GoTrue JWT／REST 付款測試 5 人、56 斷言，邀請追蹤 3 人、34 斷言；合成 SQL 55 PASS 訊息。

## 尚未完成，禁止正式發布

1. 真實 Google OAuth 和 iPhone Safari／Chrome 實機，以及三角色完整瀏覽器 E2E 尚未完成；本機 JWT 不能替代。
2. 所有 V3.5.9 核心操作與 GAS 寄件者、重試的端到端驗收尚未完成；不可啟用正式寄信。
3. 正式 schema 相容性、備份、回滾與資料稽核計畫須審查，GitHub CI 的全套 Supabase 整合亦須通過。

**不得變更真實 2026/10/20 NT$1,300 付款狀態、QA NT$625 或任何正式資料。**
