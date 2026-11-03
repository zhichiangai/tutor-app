# 好好上課 V4 正式環境部署紀錄｜2026-11-04

## 已執行、可核對的事實

- GitHub 主分支部署來源：`55919a0e977022660fc9aa25e11b9b839bf4e729`（V4 程式已於 PR #43 合併、PR #45 為安全檢查）。
- Vercel 專案 `tutor-app-v2`、正式網域 `tutor.rapid4grad.com`。
- 新 Production Deployment：`dpl_J7ho8JT6R1e6gXdtZe3tL4GUTjo6`，Vercel API 回報 READY 且正式域名已指派。
- 前一個 READY Deployment：`dpl_3LeJexu8fwdeTkZ1ajVkA1gqrVNr`，SHA `d0beb6bfab86781ca457cc2c93d2d1da19aeef04`，可作為**前端部署**回切目標；無法回滾資料庫 Migration。
- Supabase 正式 Project `vctisuglfoxyuwlvyjee` 的 Migration 由 29 增至 **43**。這是在使用者授權暫緩備份後，透過 Supabase MCP 依序套用九份 `supabase/migrations` V4 SQL 與五份 `supabase/candidates` QA SQL；未執行 `db reset`、`db push` 或 `migration repair`。
- V4 新增資料表與 RPC 已存在；`v4_accounting_qa_snapshot()` 的合成 authenticated 呼叫回傳 `qaBatchIds`、`qaLessonIds`、`qaLegacyReceiptLessonIds` 三個陣列。
- 付款 SELECT 政策的有效家長關聯條件：**3/3**。
- 套用前後核對的正式資料列數：學生 5、課程 147、付款批次 3、付款項目 3；均保持不變。此核對只是列數一致，不是正式備份，也不能保證所有內容無異動。
- Vercel Production 三項環境變數的 Ref、URL、Publishable Key 與正式 Supabase 相符，未輸出金鑰。
- GitHub-hosted Runner 公開 HTTP Smoke：首頁、舊版轉址、模組、V4 Config、GoTrue Google Provider 及匿名 QA Snapshot 拒絕等 6 項 PASS。原始碼 `tests/smoke/v4-production-http-smoke.mjs`，工作流程 `.github/workflows/v4-production-http-smoke.yml`。

## 尚未取得的驗收與限制

- 尚未操作真實 Google OAuth 授權頁面並實際登入老師／家長／學生三個帳號，不能宣稱三角色正式使用驗收通過。
- Codex Desktop IAB 仍未提供操作工具，亦不可把合成 Chromium 測試宣稱為實體手機驗收。
- 正式 Supabase 尚未部署 `v4-gas-bridge` Edge Function，Google Apps Script 真實通知沒有啟用；不能聲稱已完成實際寄信。
- 使用者明確選擇本輪暫不備份；**尚無正式可還原備份**。有真實歷史資料，若遇不可回復的 SQL 錯誤仍有資料損失風險。
- 原本的 `docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json` 是 **部署前 29 筆歷史快照**，不得視為現在的正式狀態。
- Supabase MCP 為每次套用建立新的 2026-11-03 UTC 版本，與 GitHub 原始 20261023–20261029 SQL 檔名版本不同。**未來不可直接對正式資料庫執行 Supabase CLI `db push`、`db reset` 或 `migration repair`；必須先建立已執行 SQL → 新 Migration 版本的正式對照與差異驗證。**
- Supabase Security Advisor 仍顯示多項 `SECURITY DEFINER` 函式警告，應逐項檢查函式內授權和 EXECUTE GRANT；不應盲撤銷應用仍依賴的權限。

## 後續驗收重點

1. 使用者於 `https://tutor.rapid4grad.com/` 自行完成 Google OAuth 登入並核對老師／家長／學生實際資料，不能使用或修改未授權帳號。
2. 核對課程增修、月曆、付款與解除連結後資料隔離，使用合成 QA 資料，不對既有付款紀錄做試改。
3. 再次執行六項無登入 HTTP Smoke；維護綠燈證據。
4. 實際寄信需另外取得 Google Apps Script 授權與非正式收件者測試策略；在此之前保持停用。
5. 制訂正式資料庫還原與未來 Migration 對照方案。
