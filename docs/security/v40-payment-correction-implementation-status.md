# V4 已確認付款批次更正 — 第一階段安全底座

> **DRAFT，尚未開放沖銷操作，也不得合併正式 main。**

## 已完成的程式（本 PR）

- `payment_batch_corrections` 和 `payment_batch_correction_items`：獨立更正紀錄／逐堂金額表，僅開放 RLS SELECT，不賦予任何瀏覽器 INSERT/UPDATE/DELETE。
- 不可變更 Trigger 拒絕直接修改或刪除已存在的更正紀錄。
- 使用有效學生＋老師＋workspace 連結，保護家長讀取更正歷史；老師保留本人查閱權。
- `v4_payment_correction_preview(uuid)`：限老師本人讀取已確認批次，只返回原始分配、已更正、淨額；回傳 `can_apply=false`。
- 老師付款歷史增加 **查看可更正金額（唯讀）**，只在已連線的隔離 V4 開發／測試環境顯示。
- `v2/payment-correction.js`：整數分金額驗證及兩堂課、多筆部分更正的純函式規劃工具。
- Node 靜態／計算測試；**不是資料庫 JWT 或完整 E2E 測試**。

## 尚未完成，禁止聲稱沖銷可使用

1. 以 `supabase migration new` 正式整理本 Migration，從 Mac localhost 乾淨庫重播 34 份（依目前 PR #34 的 33 份 + 本 PR 1 份核對）。
2. 開發 server-side `v4_apply_payment_correction` 原子交易 RPC；驗老師身分、已確認批次、原因長度、UUID 冪等、逐堂分配、同筆總額，鎖住 batch/student/lesson，並防止跨 workspace、超額與併發。
3. 將更正淨額同步整合到 `submit_range_payment`、`review_range_payment`、`guard_paid_lesson`、`payment-ledger.js`、老師與家長的月報，否則**不得啟用寫入 RPC**。
4. 更正歷史與餘額進入 UI，並保留老師可見、家長僅在現行學生連結下可見、學生不得看到金額。
5. GoTrue JWT／PostgREST 實測：兩堂各 1000、批次 1500；先更正 250、再更正 500；重覆 idempotency、並行超額、付款重新提交、老師權限、家長解除後無權、已收款課程變動保護。
6. iPhone／三角色及現有 V3.5.9 功能回歸，所有權限與正式資料隔離。
7. 家長邀請追蹤、到期、重新寄送仍屬 PR #34 後續工作。

**不得變更真實 2026/10/20 NT$1,300 付款狀態、QA NT$625 或任何正式資料。**
