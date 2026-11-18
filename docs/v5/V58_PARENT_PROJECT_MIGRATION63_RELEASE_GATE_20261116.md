# 好好上課 V5.8｜家長逐專案應收 62→63 正式發布閘門

更新：2026-11-16（Asia/Taipei）｜狀態：**NO-GO／不得自行變更 Production**

## 1. 版本來源與功能邊界

- 前端與六項整合：Draft [PR #80](https://github.com/zhichiangai/tutor-app/pull/80)，已驗證 Head `5b015aa36dcfabcb4da86c73ad0522532e20cbcf`：Node 438/438，隔離 PostgreSQL、QA/JWT/RLS、真 43-history replay、Chromium 60/60 均 PASS。
- 家長逐專案 RPC 候選：`supabase/candidates/20261116100000_v5_8_parent_project_scoped_receivables.sql`（Git blob `572dcbcaa0e2b6d1e7f1cb6fe0e078b93853846f`）。
- 本次資料庫**唯一**功能增量：在 `public.v56_team_parent_finance_overview(uuid,uuid,date)` 已授權的 receivable JSON 中，增加 `project_id` 與 `project_name`。Team+Project 雙鍵比對，使用 `LEFT JOIN` 保留全部應收；回傳的是已比對的 `pr.id`，不揭露未核實的 `f.project_id`。
- 保留 `20261110090000_v5_6_allocated_manual_payout_history.sql` 的完整家長 consent、V4 guardian 即時關係、revocation、Team entitlement、應收／付款／退款／預收帳務與人工退款已付狀態。只用 `CREATE OR REPLACE FUNCTION` + `REVOKE/GRANT EXECUTE`，**不新增資料表、不改欄位、不寫入商業資料**。
- 家長收款、更正、退款與預收抵扣仍是**Team 層級**，不能把逐專案應收標籤說成逐專案付款歸屬。

## 2. 當前正式環境唯讀快照（非授權）

- Supabase ref：`vctisuglfoxyuwlvyjee`。
- Production Migration：**62** 筆；最新 `20261110100000`。本候選尚未套用。
- 正式家長帳務 RPC 的 `md5(prosrc)`：`3569963e9d47af5d5e2acc728ccc8f17`；`SECURITY DEFINER`／`STABLE`／固定空 `search_path`／anon EXECUTE = false／authenticated EXECUTE = true。
- GitHub `supabase/migrations/` **只有 56 份 repo SQL 檔**，早期 V4 版本與 Production 43-history 不同；後續 19 份 V5 與正式版本可對應。**絕不可直接對正式站跑整包 `supabase db push`、`db reset` 或 `migration repair`。**
- Vercel `tutor-app-v2` 的 Production SHA 在本輪連接範圍仍 BLOCKED，須正式發布前補核；CI success 不代替 Production READY。

## 3. 本輪 63rd Migration 完整隔離演練

獨立測試分支 `test/v58-parent-project-migration63-gate-20261116`。新增
`.github/workflows/v58-parent-project-migration63-isolated.yml`，僅於 GitHub Actions 可拋棄環境：

1. 核對 `project_id = "tutor_v4_isolated"`、無 hosted link、Supabase CLI 固定 `2.107.0`。
2. 由既有歷史鎖定來源重建真實 43-history Schema-only，不取用正式學生、老師、付款或 Token。
3. 依鎖定原始碼再套用十九份 V5，核對版本數 **62**、最新版本 `20261110100000`、RLS/授權/存量表 row-count 摘要。
4. **執行 `supabase migration new v58_parent_project_scoped_receivables`**，在本地唯一新產生的第 63 筆 Migration 填入候選 SQL。
5. `supabase migration up --local`，核對 **63** 筆、僅 RPC JSON 增量、原有退款狀態、無匿名執行權限、全部應收 row counts 不變。
6. 用不同合成 JWT、三角色與 Team 跨角色資料隔離及完整 Chromium 回歸檢查，禁止 Production OAuth 或付款寫入。

**重要：** CI 產生的是一次性的第 63 筆檔案，**不會自動提交到 Main 或正式 Supabase**。審查並核實通過後，才可以把固定版本、檔案內容及雜湊鎖入實際 release PR。新文件及工作流程的 CI 未完成前，標記 NOT TESTED，不得宣稱 PASS。

## 4. 正式發布前必需條件（均需證據）

- [ ] 確認 Production 仍為 62 筆、最新 `20261110100000`，RPC `md5(prosrc)` 未漂移；若不同，停止並重新審核。
- [ ] 完成第 63 筆 SQL 的固定檔名／內容 SHA、無來源漂移、備份與還原證據（實際平台可用備份類型與保留期間須再查）。
- [ ] 無真實資料的隔離 62→63 演練與 JWT/RLS/Chromium **全部 PASS**；檢查未匹配 Project 的應收不消失、Team 間不混算、重複課程 ID 不雙計費。
- [ ] 分別取得當次明確核准：**Production SQL/Migration**；**GitHub Main 合併/Production 網站部署**。兩者不可互相推定。
- [ ] 核對 Vercel Project、Main SHA、Production SHA、READY、自訂網域，再啟動 Codex 唯讀正式站老師／家長／學生／Team + 320/375/390/430/768/1440px GUI 驗收。
- [ ] 不使用 Production 任意新增／刪除課程、付款、邀請或假帳務；Google OAuth 完整 URL、Token、Cookie 不得進入日誌或公開文件。

## 5. 失敗停損與回復設計

- 第 63 筆只替換原 RPC，無資料搬移；若在**套用前**發現任何預檢漂移，直接停止，Production 保持 62。
- 如已獲准套用 63，但後續發現 RPC 計算或授權異常，先停止後續 Main 部署，**另建立經授權的第 64 筆 forward-only 修復**，從 `20261110090000_v5_6_allocated_manual_payout_history.sql` 擷取最新版舊 `v56_team_parent_finance_overview` 函式與原始 `REVOKE/GRANT`，在隔離環境驗證後才可套用；不得手動刪除 Migration history 或重置正式資料庫。
- 若已部署新版前端，使用 Vercel 既有經核准的回滾路徑，版本／資料庫相容性需分別核對；「功能回復」不代表平台自動回退 Migration。
- 當前專案未提供已驗證的 Production 可回復點，所以**未完成備份／復原演練前，即使全部 CI PASS 也保持 NO-GO**。

## 6. 最新工作授權

允許在 GitHub **開發分支、Draft PR、隔離 PostgreSQL/Chromium** 內進行程式與測試；**禁止自行**合併 Main、操作 Production SQL/RLS/Auth、修改真實帳務、變更 Vercel Production 或觸發含資料寫入權限的保護工作流程。
