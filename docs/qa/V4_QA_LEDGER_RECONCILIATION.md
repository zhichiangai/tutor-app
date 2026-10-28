# V4 QA 收款 P0｜分類與統計修補候選（待隔離實測）

> 來源：2026-10-29 Codex 正式站唯讀觀察。正式老師收付款的「已確認收款」包含標示 QA 且註明無實際轉帳的一堂課；同一堂課有兩個部分付款分配。這不是兩堂課，也無法單憑 UI 確認資料庫已標記 QA。**所有正式紀錄保持原樣。**

## 分類應分三層，不能混為一談

| 情況 | 安全分類 | 正式學費／應收 | 正式已收現金 | 既有狀態／紀錄 |
| --- | --- | --- | --- | --- |
| 整堂課是虛構測試課程 | `v4_lesson_qa_marks.classification='simulated_lesson'`, `is_qa=true` | 排除整堂 QA 課程 | 0；已確認的相關付款批次必須先逐筆標記 QA | 保留 |
| 課程是真的，部分匯款是 QA 測試 | `v4_payment_batch_qa_marks.is_qa=true` | 原應收保持不變 | 只排除該 QA batch 的分配，其他正式 batch 保留 | 保留 |
| 課程是真的，舊式「老師已收到」僅為模擬 | `v4_lesson_qa_marks.classification='simulated_legacy_receipt'`, `is_qa=true` | 原應收保持不變 | 模擬的舊式單堂收款視為 0；只有當該課程沒有 payment_batch_items 才可標記 | 保留 |

同堂兩筆 batch，若一筆 QA 400、一筆真實 600，且應收 1000：**正式已收 600、未收 400**。若兩筆均 QA：正式已收 0、未收 1000；只有整堂課本身虛構且符合 guard 時，才排除其 1000 應收。上述金額僅合成案例，非正式帳務紀錄。

不得用學生姓名、備註、收款日期或家長填寫的自由文字自動把正式交易分類為 QA。分類必須由有權老師逐筆審查並留稽核。

## 此 PR 已有

- `supabase/candidates/20261028_v4_payment_batch_qa_classification.sql`：批次標記與稽核；舊檔。
- `supabase/candidates/20261029_v4_qa_lesson_and_legacy_receipt.sql`：新增整堂課／舊式單堂模擬收款的標記與稽核，限制老師身分，並阻止整堂課的 QA 標記掩蓋未分類的已確認交易。
- `v2/payment-ledger.js`：可選的 `qaTags` 輸入，支援 `qaBatchIds`、`qaLessonIds`、`qaLegacyReceiptLessonIds`；沒有結構化分類輸入時保留舊計算。
- `tests/v4-qa-ledger-allocation-regression.mjs` 及分類安全結構測試：測試同堂部分付款、QA/真實混合、舊式單堂收款、整堂課 QA 不計費。

## P0 未完成，禁止發布的條件

1. 此 SQL 位於 `supabase/candidates`，**不是 Migration**，未套用正式 Supabase。確定與 V4 29+待部署 Migration 相容後，需在隔離庫以真實老師／家長／學生 JWT 執行 RLS、Trigger／稽核測試。
2. 目前前端 `lessonBalance` 等呼叫 **尚未接上**後端 QA 標記查詢，`qaTags` 預設為空。不得聲稱正式摘要已排除 QA。
3. 分類要正確帶入 `renderBilling`、`renderStudentBilling`、`renderHomeFocus`、`visiblePaymentBatches` 與付款日期歷史的 QA 顯示。若載入分類標記失敗，必須顯示「正式收款統計無法驗證」而非無聲地把金額當真；不能因誤用空資料或 RLS 錯誤，把待付款誤判成已付。
4. 要驗證已確認付款批次的修正／沖銷對分類與總額的影響；不能重複入帳或將 QA 排除計算成退款。
5. 整堂 QA、單筆 QA、舊式模擬收款互相切換與撤銷分類時，需要保證各層摘要有一致口徑，且所有分類操作只能由所屬老師完成。不得因有 QA 記錄就抹掉真實學生的學習紀錄。
6. 需在隔離資料庫新增正規 Migration 後，先完成備份／還原演練、版本回滾計畫，再單獨取得 Production Migration 與真實付款分類核准。

## Codex 的後續工作

Codex 用瀏覽器驗收**有安全合成資料的 Preview**，確認同堂 QA 兩筆部分付款、混合真實付款、QA 標籤、課程期間篩選及老師／家長顯示。正式站只能唯讀；這份文件不是讓 Codex 自行改資料或執行 SQL 的授權。

PR #39 已另行修正付款日期措辭和月份過濾，但尚未合併正式站，請勿在 Production V3.5.9 重複回報為「新修正未生效」。
