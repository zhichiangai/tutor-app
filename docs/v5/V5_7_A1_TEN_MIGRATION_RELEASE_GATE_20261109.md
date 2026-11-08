# 好好上課｜V5.7 A1 十份 Migration 正式發布前置核對（2026-11-09）

## 結論：NO-GO，僅完成唯讀資訊與 SQL 原始碼清單鎖定

此文件**不是**正式 Migration 執行授權，不代表真實正式 43-history Schema 相容演練通過。本輪沒有執行任何正式 DDL、RLS/GRANT、資料刪除、OAuth、金流或發信操作。

### 本輪已核對的事實

| 項目 | 結果 |
| --- | --- |
| GitHub Main | `a3cc16ccd39a1c0cdd08396267dbd0b1c891fd02` |
| Vercel Production | 同 Main SHA，Deployment `dpl_5sVtuYPH8E6KgFdqTFA49Qj4w1ki`，READY |
| Supabase Production ref | `vctisuglfoxyuwlvyjee`，ACTIVE_HEALTHY |
| 透過唯讀 SQL 計算的 Migration | 43，最新 `20261103212647` |
| Production `public.v5_*` 表／函式／Policy | 0／0／0 |
| Repo 內 V5.1–V5.7 SQL | **10 份**；既有九份 V5.1–V5.4，加上 V5.7 第十份 |
| 前九份 blob SHA | 與 2026-11-08 九份 manifest 一致，9/9 |
| 新增第十份 | `20261108230000_v57_team_operations_overview.sql`（6,385 bytes；SHA `dc2233dc53f82eee031e9009b34756d27a05d4d1`） |

本輪已實際對正式 Supabase 執行 `supabase/diagnostics/v5_production_a1_ten_migration_gate_readonly.sql`，只有 `WITH ... SELECT`，沒有新增、修改或刪除資料。結果：`migration_count=43`、`latest_migration=20261103212647`、`v5_version_collisions=0`、`existing_v5_objects={tables:0,functions:0,triggers:0,policies:0}`、`v4_core_tables=8`、`v4_core_rls_enabled=8`、`v4_core_anon_direct_select=0`、`missing_required_columns=[]`、`stored_migration_sql_missing=0`、`migration_history_rollbacks_present=0`、`actual_43_history_schema_replay_verified=false`。此結果僅是 metadata，未完成正式相容性演練。

第十份 SQL 使用 `public.v5_teams`、`public.v5_team_governance`、`public.v5_workspace_entitlements`、V5.3/V5.4 私有帳務與稽核表；故**不能單獨在 V4 正式庫執行**。它提供 Team 管理者營運摘要，須獨立驗證授權檢查、跨 Team 隔離與金額彙總；SQL 檔中的 `SECURITY DEFINER` 與 `GRANT EXECUTE` 必須在真實 JWT/RLS 測試中確認安全性。

原有 `V5_A1_NINE_MIGRATION_SOURCE_LOCK_20261108.json` 保留，不能覆寫歷史審核證據。新增 `V5_A1_TEN_MIGRATION_SOURCE_LOCK_20261109.json` 並用 Node 契約驗證檔案名、順序、Git blob SHA 與 bytes；**僅證明原始碼未遭非預期變更，不證明 Migration 可套用或可回滾**。

### 發布閘門

| Gate | 條件 | 2026-11-09 本輪結果 |
| --- | --- | --- |
| A1-R1 | 43 個正式 Migration 與 V4 Schema Metadata 唯讀核對 | PARTIAL：本輪新十份唯讀診斷顯示 43 筆、10 份版本碰撞 0、既有 V5 物件 0、V4 核心 8/8 RLS、anon 直接 SELECT 0、必要欄位缺漏 0；尚不等於逐 RPC 權限語意或完整 Schema replay |
| A1-R2 | 十份 SQL SHA／順序鎖定，未來來源變更需重審 | SOURCE LOCK 檔已建立；CI 待確認 |
| A1-R3 | 從**真實 43-history 的 Schema-only、無學生與付款資料**建立隔離副本，逐份執行 10 份 V5 SQL；驗證既有 V4 Trigger/RPC/RLS，並完成失敗停止及回復演練 | **BLOCKED／NOT TESTED**：尚未取得並驗證隔離副本 |
| A1-R4 | Google OAuth／回呼、GAS/Resend 通知、正式設定、Privileged RPC 授權與停損 | PARTIAL：不可寄信、不可讀取密鑰；不得臆測已通過 |
| A1-R5 | 明確批准正式 Supabase 10 份向前增量 SQL 與 Main 正式發布，逐項檢查授權／回復 | **NOT AUTHORIZED** |
| A1-R6 | 經授權的正式 Team 管理者、一般老師、家長、學生及手機 GUI；資料隔離、帳務、V5.6 更正退款 | **NOT TESTED／BLOCKED** |

### 隔離演練最低驗收條件

- 只使用 schema-only、無 PII 的 43-history 正式相容基底；不得將正式連線憑證、Auth 或學生／付款資料帶到公開 CI。
- 順序驗證十份 V5 原始碼；每份記錄版本、原始碼雜湊、套用結果及失敗停止條件。
- 特別測試 V5.1 對既有 `workspaces`、`students`、`workspace_members` 的 Trigger 與名額影響，避免破壞 V4 個人家教。
- Team 學生、課表、應收、付款、預收、管理權及報表使用合成 JWT：Team 管理者與一般老師、不同 Team、家長與學生各自越權請求必須拒絕。
- 帳務視圖／`SECURITY DEFINER` RPC 必須檢查實際 row 範圍，不以「已開 RLS」或前端隱藏按鈕作為安全證據。
- 不透過 `db reset`、全部歷史 `db push`、`migration repair`、`TRUNCATE` 或刪除正式 Auth 來跳過相容問題。
- 正式環境即使資料當前可捨棄，沒有逐次授權也**不得執行 Production Migration**。

### A1-R4 外部服務唯讀補查（2026-11-09）

- Vercel `tutor-app-v2` 正式自訂網域 `tutor.rapid4grad.com` 顯示 verified。
- Vercel 正式環境有三個加密變數鍵名：`V4_PRODUCTION_SUPABASE_PROJECT_REF`、`V4_PRODUCTION_SUPABASE_URL`、`V4_PRODUCTION_SUPABASE_PUBLISHABLE_KEY`；**未解密、未讀取值**，不等於已驗證值正確。
- Supabase Project 的 `list_edge_functions` 返回空清單，尚無正式 Edge Function 部署證據。不能宣稱 V4 GAS/通知或 V5 通知整合已可用。
- Supabase `list_branches` 只有 main，未建立真實 43-history Schema 隔離副本，也未新增付費資源。
- Google OAuth Provider 的 Dashboard 設定與真實三角色重新登入屬正式 Codex IAB 驗收；本輪未操作、不修改 OAuth、不寄送訊息。因此 **A1-R4 仍 PARTIAL**。

### 尚未解決的風險

1. 現有報告的九份發布清單落後於 Main 新增的 V5.7 SQL；本輪新增十份清單，但尚未完成真正 R3。
2. 正式 V4 43-history 與 repo 的 Migration 編號／內容不是同一套完整重放基底。乾淨 CI 重放不能替代正式 43-history 相容演練。
3. Team 的個人／團隊資料雖有獨立表，但名額與方案透過既有 workspace 及 Team anchor 存在耦合，不得宣稱雙訂閱完全獨立。
4. Security Advisor 仍存在 19 個既有 `SECURITY DEFINER` 可執行警告與 10 個無 Policy 的 INFO，需針對實際權限語意逐項確認，不可只為清除警告增加寬鬆授權。
5. V5.6 帳務更正／退款尚未完成；正式站 Team 功能仍不可宣告可用。

**下一步**：先完成 A1-R3 無資料 Schema-only 隔離演練，報告逐份結果，再提出精確十份 Migration 及回復方案取得獨立授權；目前沒有執行正式環境的下一步操作。
