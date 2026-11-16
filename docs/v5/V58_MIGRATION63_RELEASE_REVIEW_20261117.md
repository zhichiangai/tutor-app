# 好好上課 V5.8｜第 63 筆 Migration 固定來源與雙重發布閘門

日期：2026-11-17（Asia/Taipei）｜**發布決議：NO-GO**（開發分支審查候選，不是正式發布授權）

## 1. 原始碼及依賴順序

- GitHub `main` 發布基準：`8cf48e3bfcd0f11638db3141bcf47d89e11e94fe`（本輪再次查證，未合併 V5.8）。
- 已完成六項整合的 [PR #80](https://github.com/zhichiangai/tutor-app/pull/80)：Head `5b015aa36dcfabcb4da86c73ad0522532e20cbcf`，Node 438/438、Chromium 60/60、隔離 PostgreSQL + 真 43-history 皆 PASS。
- 已完成 62→63 CLI 隔離驗證的 [PR #81](https://github.com/zhichiangai/tutor-app/pull/81)：Head `4ed38043ff9bd4698991a8f2a117cd45c59c7c92`，兩套 Chromium 60/60 PASS，CI [43897135193](https://github.com/zhichiangai/tutor-app/actions/runs/43897135193)、[43897134901](https://github.com/zhichiangai/tutor-app/actions/runs/43897134901)。
- 本 Release Branch：`release/v58-parent-project-63-20261117`，從上述 PR #81 Head 建立，**不直接推 Main**。

### 固定 SQL 原始碼

| 欄位 | 已鎖定值 |
| --- | --- |
| 固定 Migration 版本 | `20261117010000` |
| 檔名 | `20261117010000_v58_parent_project_scoped_receivables.sql` |
| 審查候選位置（**非** active migration 目錄） | `supabase/release-candidates/` |
| 確認過的來源 | `supabase/candidates/20261116100000_v5_8_parent_project_scoped_receivables.sql` |
| Git blob SHA-1 | `572dcbcaa0e2b6d1e7f1cb6fe0e078b93853846f` |
| UTF-8 bytes | 6080 |
| Source lock | `docs/v5/catalog/V58_PARENT_PROJECT_MIGRATION63_SOURCE_LOCK_20261117.json` |

此 SQL 只 `CREATE OR REPLACE` 家長既有 `v56_team_parent_finance_overview` RPC 的應收欄位，再做函式 `REVOKE/GRANT EXECUTE`。維持 Team+Project 安全關聯、撤回同意、原 V4 家長連結與人工退款狀態；不更改表格、不新增財務紀錄、不宣稱逐專案付款分配。

## 2. 正式 Supabase 62→63 前置檢查

唯讀工具目前核對專案 `vctisuglfoxyuwlvyjee`：

- Migration 62、latest `20261110100000`。
- 當前 Parent RPC `md5(prosrc)=3569963e9d47af5d5e2acc728ccc8f17`。
- 固定的第 63 筆版本沒有撞號、`anon` 不可 EXECUTE 家長財務 RPC、`authenticated` 可 EXECUTE 但還須通過內部 Guardian/Consent/Team 授權。
- `tutor_private.v5_team_lesson_fees` 啟用 RLS，`anon/authenticated` 不可直接 SELECT；`v5_team_projects` 啟用 RLS。
- 本輪來源 `supabase/diagnostics/v58_parent_project_migration63_preflight_readonly.sql` 在正式 Supabase 只讀執行，狀態 **PASS**；**不包含正式資料列值、帳密或 Token**。

**安全限制：** Repo `supabase/migrations/` 56 份檔案，與正式 62 筆歷史不是完全同一套 V4 編號。不可直接對 Production 執行整包 `supabase db push`、`db reset`、`migration repair`。

## 3. Release Branch 驗證流程

固定來源的隔離驗證會：
1. 由已封存的真實 43-history Schema-only 重播，套用已鎖定 19 筆 V5 到 62。
2. 執行可拋棄環境的來源 SHA/bytes 合約及唯讀 62 筆 SQL 預檢。
3. 以固定版本 Supabase CLI `2.107.0` 執行 `supabase migration new`，本地將空白 CLI 範本改名為**已審定的固定版本** `20261117010000`，複製相同 Git blob 的 release-candidate SQL。
4. 在**隔離資料庫**執行 `migration up --local`，確認版本數 63、不變的資料筆數、RLS/匿名權限、Guardian/Team/Refund 狀態。
5. 以合成帳號重新跑老師、家長、學生與 Team Chromium 測試。**不能把 CI 的 local PASS 當成正式 Production GUI PASS**。

固定版本的最終 Release CI 必須核對此分支的**最新 Head**；前一分支的 PASS 不是新 Head 的 PASS。

## 4. 正式備份、回復與部署阻擋事項

**目前缺乏已驗證的正式資料備份與回復證據，保持 BLOCKED。** 現階段能讀取正式 DB Migration/RPC/RLS 中繼資料，但可用 Supabase 工具沒有提供可查證的最新備份清單、復原點與恢復演練證據。不得聲稱已有 PITR、每日備份、可用 RTO/RPO，也不得直接操作 restore。

如果正式更新後發現錯誤：
- **SQL 套用前** preflight 不一致：停止，不執行 63。
- **SQL 套用後**才發現權限／資料異常：停止新版 Main 部署。使用當次另行核准的第 64 筆 forward-only RPC 修復 Migration（採用 `20261110090000_v5_6_allocated_manual_payout_history.sql` 已核對的完整舊 RPC／ACL，先在隔離環境測試）；不得直接刪除正式 Migration 紀錄或 reset 資料。
- 若新版已上線：依已核對的 Vercel 部署與回復方案回到先前相容的程式版本；回退程式**不等於**已回復 DB。

Vercel 連接僅列出 Team `zhichiang-ai-s-projects` 下的 `rapid4grad-website`，找不到正式 `tutor-app-v2`，因此 Production SHA/READY/綁定**BLOCKED**；在取得正確專案連接權限前，不能進入正式發布驗收。

## 5. 實際正式發布順序（待使用者當次授權，非執行指令）

1. 確認正確 Vercel 專案、Main／Production SHA、正式資料備份與可回復點。
2. 合併前由產品負責人審核 Release PR 的**固定 63 SQL 原始碼 SHA、版本、隔離 JWT/RLS/Chromium 證據**。
3. 取得當次**獨立** Production SQL 第 63 筆核准；在受保護、限制寫入權的發布執行通道，只套用該 SQL，稽核版本、RPC 權限與既有帳務；嚴禁對 43-history＋19 差異執行整批 migration push。
4. 驗證資料庫成功後，再取得當次**獨立** Main 合併與 Vercel Production 發布核准。避免在資料庫未就緒時先發布需要 63 RPC 的前端。
5. 核對 Main SHA＝Production SHA、Vercel READY、正式網域，再交 Codex 在 **Production 唯讀**、保護 OAuth 的工作階段執行 5 角色＋六尺寸 GUI。

**目前授權：僅 GitHub Release 分支、Draft PR、CI/隔離 SQL/合成角色測試與正式資料庫 metadata 唯讀查核。正式 SQL、Main、Production 皆不允許自行改動。**
