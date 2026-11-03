# V4 正式資料庫升級：財務函式基線與執行門檻

> 2026-11-04（臺北）。**目前仍 NO-GO**。本文件為唯讀核對紀錄，並非允許修改 Production。

## 已確認事實

- 正式 Supabase：`vctisuglfoxyuwlvyjee`，29 筆正式 Migration；Repo 則有 28 筆本機基線 + 9 筆 V4 forward，正式歷史內有 18 筆與本機基線版本不一致。
- `v4_accounting_qa_snapshot()` 與 `payment_batch_corrections` 尚不存在；直接啟用 V4 Production 會在登入後的資料同步階段失敗。
- `payment_batches`、`payment_batch_items`、`family_requests` 三條家長付款 SELECT 政策尚未加入有效關聯驗證，P0 修補尚未部署。
- 2026-11-04 的正式財務函式唯讀指紋檢查：**3/3 MATCH**。這只表示三個現存 SQL 函式在記錄時與基線一致，不證明新 V4 Migration 相容。
- GitHub `main` 已合併 V4，但 Vercel Production 自動建置暫停；正式站維持舊 READY 部署。
- 沒有已驗證的**正式資料全量備份與獨立還原**證據，因此不能在 Production 執行 Hotfix 或 forward migrations。

## 唯讀函式基線

執行 `supabase/diagnostics/v4_financial_function_fingerprint_readonly.sql`，預期三列 `fingerprint_status = MATCH`：

| 函式 | 正式資料庫定義 MD5 |
| --- | --- |
| `tutor_private.submit_range_payment` | `1a2b0e76a06511fc6455b3d852f70a97` |
| `tutor_private.review_range_payment` | `5fd9a1486095c7f142f565b42759d680` |
| `tutor_private.guard_paid_lesson` | `316acb8483b05c2f5972764d65b969a2` |

結果不是 MATCH 時停止，重新審查正式 RPC 與準備套用的 SQL。MD5 是**異動偵測**，不是內容安全證明，不能替代語意審核。不要將 Production 財務資料匯入 GitHub、PR 或 CI。

## 發布前不可省略的 Gate

1. 保留正式 Vercel 既有可回復部署，確定 DNS 與 Production SHA；正式部署需能立即回切。
2. 完成**全量正式資料庫及 Auth/Storage 相關資料的可驗證備份**，紀錄備份時間、完整性雜湊、保管地點與復原負責人。
3. 在與 Production 分離的 Supabase 目標還原備份，驗證重要資料筆數及外鍵、RLS 與登入；若使用真實個資，必須有適當的安全防護，不可直接用於一般 Preview QA。
4. 比對 29 筆正式 migration 與九筆前進候選 SQL 的依賴、RPC 定義、表／欄位、約束，驗證三個財務函式指紋仍一致；**禁止 `db push`、`db reset` 或 migration repair 直接對正式資料庫執行**。
5. P0 Hotfix 的前置檢查 PASS 且恢復計畫就緒後，另行核准正式 RLS 修補；以老師、家長、解除關聯、學生、匿名 JWT 的實際測試證明隱私權限。
6. 在隔離環境驗證九筆 V4 forward migration，包含付款更正、跨月／臺北日期、QA 與 GAS 佇列；確認沒有覆蓋不相容的正式 RPC。
7. 只有正式 Schema、備份還原、安全性與 Google OAuth/角色驗收都滿足後，才恢復 Vercel Production 新建置／發布 V4。IAB BLOCKED 不代表 UI PASS。

## 隔離雲端環境與費用

Supabase 開發分支需要使用者明確同意費率後才能建立。2026-11-04 查到的報價為 **US$0.01344/小時**；尚未收到此費用確認，因此沒有建立付費分支或把真實資料複製過去。

## 操作責任

ChatGPT 負責 SQL/程式、GitHub、CI、雲端部署準備與唯讀檢查。Codex Desktop 僅在 IAB READY 後進行實際點擊、輸入、截圖的 UI QA；IAB BLOCKED 期間不能冒稱已完成 Google 登入驗收。

## 前進相容性依賴清查（唯讀）

執行 `supabase/diagnostics/v4_forward_dependency_readonly.sql`：

- 2026-11-04 Production 實測：基礎 11 張必要表與 23 個欄位均存在；3 個財務函式存在，`student_guardians` 已啟用 RLS。
- `schema_stage = V4_NOT_INSTALLED`：四張關鍵 V4 新表仍未建立；`active_link_guarded_payment_policies = 0`（3 條中 0 條）。
- 如結果是 `BASELINE_MISSING_DEPENDENCIES` 或 `PARTIAL_V4_SCHEMA_STOP`，必須停止升級並追查差異。
- 即使依賴完整且三個財務函式都 MATCH，`release_gate` 仍是 `NO_GO_UNTIL_BACKUP_RESTORE_AND_FORWARD_TEST`。

此 SQL 僅查 catalog 與 information_schema，不讀取學生姓名、課程或付款資料。
