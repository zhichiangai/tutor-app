# 好好上課 V5.4｜正式 Schema 相容、備份還原、受控發布作業書

> **2026-11-08 最新決策／歷史文件提示：** 使用者已確認現有課程、帳務及登入資料均為可捨棄測試資料，不再將舊測試資料備份與完整歷史還原列為 V5 開發必要門檻。本文若要求 G2 舊資料備份／還原，僅代表 **2026-11-06 的歷史發布假設**，不可視為現行決策。正式發行安全關卡改以 [V5.5 正式 Schema／RLS 唯讀審核](./V5_5_PRODUCTION_SCHEMA_RLS_RELEASE_AUDIT_20261108.md) 為準；但仍禁止未授權清空 Production、修改 Auth／RLS 或合併 Main。

> 2026-11-06。狀態：**NO-GO／部分驗證**。本文件不授權任何 Production SQL、資料複製、分支建立收費、Main Merge 或 Vercel 部署。
> 所有正式資料庫操作均須以當次正式授權、私密憑證管理及新鮮備份為前提；此處沒有任何帳密或真實學生資料。

## 0. 本輪的實際環境與限制

- 正式 Supabase `vctisuglfoxyuwlvyjee` 所屬組織 `rapid4grad` 目前為 **Free**；官方只承諾 Pro／Team／Enterprise 的自動每日備份，Free 應使用受保護的邏輯備份與站外儲存。查看 <https://supabase.com/docs/guides/platform/backups>。
- 本輪已唯讀核對正式 Migration **43** 筆、最新 `20261103212647`，正式 V5 資料表 **0**。repo 工作樹有 46 份 SQL，其中 9 份 V5；正式有 32 個 Migration 版本號不直接匹配 repo（請勿推論 32 份 SQL 功能不同，也不可視為已證明等價）。
- GitHub PR #51 至 #56 均為 Draft；Main 仍為 `894a6228994c3fb0f1c1448aa6d470c56f90053e`。Vercel Production 維持舊站。
- Supabase 原生分支**不會複製正式資料**，僅由 migration 重建 schema，不能充當備份還原；建立新分支觸發額外費用確認，本輪未獲授權、未建立。
- 目前連接的 Supabase 工具**無備份清單／下載備份／複製正式專案至獨立備援專案的專用動作**。因此無法據此宣告正式備份存在、已下載或曾成功還原。
- 本輪新建 `supabase/diagnostics/v5_production_schema_catalog_readonly.sql`，並將七張核心 V4 表的**不含個資**欄位、約束、政策名及觸發器名存於 `V5_PRODUCTION_V4_SCHEMA_CATALOG_20261106.json`。這不等於完整 schema backup，也不包含 RLS 的所有 SQL 語義。
- CI 額外加入 **合成資料選定 Schema pg_dump→pg_restore（public、tutor_private、auth、supabase_migrations；不涵蓋 Realtime／Storage 平台物件）** 和**七表結構比對**。兩種測試均在可丟棄的 localhost Supabase 執行；是否 PASS 以最新 CI 為準，不能視為正式資料可還原。

## 1. G2：真正正式備份／還原必須如何驗證（此項尚未完成）

### 1.1 出廠前檢查（唯讀）

1. 確認當前 Production 專案／地區／PostgreSQL 版本、43 筆 migration 版本及 RLS。
2. 在帳務寫入切換前，識別所有外部副作用：`pg_cron`、`pg_net`、webhooks、Edge Functions、GAS、Resend／郵件、外部付款通知與排程。複製到隔離庫後**先阻斷對外寄送／寫入**，避免測試資料真的發出通知。
3. 若不升級方案，安排具備資料庫存取權限的操作人員，依官方 <https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore> 建立**受保護的邏輯備份**。用最新 `supabase db dump --help` 核對旗標。
4. 備份必須涵蓋：schema、data、`auth`、`supabase_migrations`、角色／權限、extensions、專案自建 trigger/RLS/RPC 及所有必要來源表；不要誤以為 CLI 預設 dump 含 `auth` 與 `storage`。**Storage API 物件內容另行備份**，資料庫備份通常只含其 metadata。
5. 備份輸出僅在加密、存取受限、與正式專案不同故障域的位置保存；不得上傳 GitHub、CI Artifact、聊天檔案、公開雲端硬碟。保留專案識別、備份 UTC 時間、尺寸、SHA-256、備份工具／Postgres 版本及操作者，**不記錄機密**。

### 1.2 隔離還原（不能把 Production 原地 Restore）

1. 以獲授權、可控成本的**獨立** PostgreSQL／Supabase 專案建置還原目標；預先停用外部通知、排程與真實回呼，禁止連正式 Vercel Domain。
2. 使用匹配的 PostgreSQL 版本，依官方 restore 指引恢復資料、權限與管理 schema。切勿使用 `restore_project` 對原正式 Project 執行，切勿使用 `merge_branch` 將測試 Migration 套回正式庫。
3. 還原後比對備份建立當下的原始證據：43 筆 migration 版本與順序、schema 簽章、Auth 使用者筆數、V4 工作區／會員／學生／家長關聯／課程／付款筆數、關鍵 FK、RLS 與 RPC 存在性、重要帳務彙總與校驗值。完整數值只保存在私密驗收證據，不得寫入 Git。
4. 以實際已授權測試身份驗證登入／解除連結／歷史 ID 擋存、付款隔離和已結清防護。若無法阻止通知對外發出，必須保持隔離端唯讀並判定 BLOCKED。
5. 取得**一致且可重複的校驗證據**才能標記 G2 PASS；單有備份檔、DB 連線成功或結構快照，都只能 PARTIAL。

### 1.3 實際備份後需記錄的私密證據（不得包含憑證或原始明細）

| 證據 | 要求 |
| --- | --- |
| Backup ID / UTC timestamp / SHA-256 / 來源 DB 版本 | 實際工具產出，時間與操作人可追溯 |
| 資料表和角色數量、migrations、FK/RLS/trigger/RPC | 備份／還原端驗證前後一致 |
| Auth / 課程 / 付款校驗摘要 | 保存在存取受限的證據庫，不公開真實內容 |
| 還原耗時與復原後可登入驗證 | 實際量測，不預估或捏造 |
| 最後寫入凍結與可接受資料遺失範圍 | 事前由使用者確認 |
| 外部郵件/Webhook/cron 禁止副作用證據 | 有工具日誌或截圖，否則 BLOCKED |

## 2. G3：以真正正式 43 Migration Schema 為起點的 V5 相容測試

1. 獨立還原環境應保留**實際**正式 43 個已套用版本和 schema；不得把 repo 的 28 份重播基線、9 份舊 V4 候選重新套用，更不能寫入 `supabase_migrations` 假裝歷史版本匹配。
2. 先比較 `V5_PRODUCTION_V4_SCHEMA_CATALOG_20261106.json` 七張表欄位型別、nullable、約束、RLS、原有 Trigger／Policy；再用完整 `pg_dump --schema-only`／RLS 函式 diff 校驗較深層語義，最終以還原庫實測為準。
3. 從 repo 提取以下**9 份 V5-only 增量 SQL**，依 timestamp 逐份執行於還原庫，記錄每步 SQL hash、開始／結束、實際結果和失敗回滾；不可用 `supabase db push` 從 repo 根目錄直接對正式庫執行。

   ```text
   20261104131300_v5_1_entitlements_student_seats.sql
   20261105171000_v5_1_admin_qa_release.sql
   20261105181500_v5_2_team_projects_invitations.sql
   20261105192000_v5_2_team_governance_transfer.sql
   20261105201500_v5_3_team_data_boundaries.sql
   20261106031000_v5_3_team_billing_foundation.sql
   20261106034000_v5_3_partial_payment_allocation.sql
   20261106043000_v5_4_team_advance_credit.sql
   20261106050000_v5_4_team_monthly_reconciliation.sql
   ```

4. **特別要測 V5.1 對原 V4 表的影響**：`public.students` 名額 guard、`public.workspaces` entitlement seeding、`public.workspace_members` 老師上限，以及已存在學生與課程新增／更改／刪除與 V4 月曆行為。V5.2 會修改 `workspace_members` SELECT 政策。
5. 帳務鎖：在合成學生下執行，所有真實資料唯讀。V5.4 預收金額守恆、跨課程／月份、並發同一信用餘額、跨學生拒絕、管理權移轉後撤權、前端不顯示學生金額。
6. 驗證 V4 既有記錄和 `auth.users` 不被改寫／丟失：欄位前後簽章、原始資料筆數、業務可見權限要一致。所有不合格項目均維持 G3 FAIL／NO-GO，不能只以 35/35 Playwright 當 Production 相容證據。

## 3. G4/G6：正式發布順序與可回復策略（待核准）

1. 冻結 PR #51 → #52 → #53 → #54 → #55 → #56 的整合 Commit；全部校驗、正式還原庫和完整合成 QA 通過，保留版本 SHA。
2. 後端與前端需要**功能開關**；在正式 V5 尚未準備完畢時，不得因 Main 自動部署讓使用者看到未配置 RPC 的帳務入口。
3. **先有新鮮完整備份與還原校驗，後有正式 Migration**。正式用的 SQL 清單只能包含 V5-only 的向前增量，需指定每步前置條件、檢查當前 schema 並記錄已執行版本；不能重複執行不匹配的 V4 歷史，也不能直接修改正式 `schema_migrations` 避開檢查。
4. **正式資料庫變更**、**合併 Main／Vercel Production 部署**、**付費隔離資源／資料複製**是分開授權。先執行經核准的 Database 切換，再以最小風險部署前端；每一步先跑 V4 健康檢查。
5. 後端或帳務出錯時先關閉 V5 寫入、保留 audit 與日誌，判斷能否安全**向前修復**。前端回退舊 Vercel SHA **不會**回退 Supabase Schema 或交易紀錄；不可自動執行破壞性 down migration。
6. 真的需要資料庫還原時，必須了解備份之後新的寫入如何保全：RPO／RTO 由使用者明確決定；回復會涉及業務停機和人工對帳。未經授權不對正式庫原地還原。

## 4. 本輪結論與發佈門檻

| Gate | 目前可證明 | 必須剩下的 |
| --- | --- | --- |
| G1 唯讀正式 Schema | 43 Migration、七張核心 V4 table catalog 已留存 | 完整 function／RLS expression diff；新鮮快照 |
| G2 真的正式備份／還原 | **BLOCKED**：Free、無可用備份／還原工具及付費獨立環境授權 | 加密備份、獨立還原、Auth／資料校驗 |
| G2a 合成資料 backup→restore | CI 腳本已加，**須等最新 CI 結果** | 成功後只能宣稱合成流程 PASS |
| G3 43 Schema → V5 Migration | **NOT TESTED** 真正正式還原端 | 必須在隔離還原庫逐份套用 V5-only |
| G3a 七表結構差異 | CI 腳本已加，**須等最新 CI 結果** | 結構相符也不等於完整 Schema／資料相容 |
| G4 合成隔離 V5 | 前一版隔離 Chromium 35/35、Node 309/309 PASS | 最新 Head CI 與還原環境回歸 |
| G6 正式發布 | **NO-GO** | 上述證據 + 使用者分別核准 |

參考：[Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)、[CLI Backup & Restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)、[Supabase Branching](https://supabase.com/docs/guides/deployment/branching)。不允許把「branch 建立成功」或「程式測試成功」寫成「正式資料已備份／已還原」。
## 5. 2026-11-10 V5.6 故障回復與最新相容性更新

本節是本作業書的較新狀態補充；前述 V5.4/九份 SQL 與 PR #51–#56 均為歷史快照，不能當作目前 V5 Migration 清單。

### 5.1 已重新核對的證據

- PR #68 最新 Head：`b3fbfcc980f6551ea490a83c9b140a9e36558fda`，仍 Open/Draft。該 SHA 的 5 個 GitHub Actions workflow 均 success，其中 A1-R3 專用工作流以正式來源的 43 歷史版本在一次性 Supabase CI 中重播，接著於同一隔離 DB 套用 19 份 V5 forward SQL，62/62 PASS；V4/V5 RLS、RPC grants、合成 GoTrue/JWT/PostgREST 與 Chromium 工作亦通過。
- Production 只做 metadata 唯讀核對：Supabase 專案為 ACTIVE_HEALTHY，migration history 43 筆，最新 `20261103212647`，public schema 中 `team_`／`v5_` 命名 table 為 0。沒有 Production SQL、Auth、RLS、資料寫入或 migration。
- A1-R3 43-history schema 相容重播目前 PASS；這不代表正式備份還原、失敗回復、Production UI、外部副作用或正式發布已通過。Production V5 維持 NO-GO。

### 5.2 PR #68 的 V5 forward 順序

下列順序固定以 timestamp 遞增及該 Head 的 source-lock 為準；不可手動重排、改寫已鎖定 SQL 或只挑選較方便的檔案：

1. `20261104131300_v5_1_entitlements_student_seats.sql`
2. `20261105171000_v5_1_admin_qa_release.sql`
3. `20261105181500_v5_2_team_projects_invitations.sql`
4. `20261105192000_v5_2_team_governance_transfer.sql`
5. `20261105201500_v5_3_team_data_boundaries.sql`
6. `20261106031000_v5_3_team_billing_foundation.sql`
7. `20261106034000_v5_3_partial_payment_allocation.sql`
8. `20261106043000_v5_4_team_advance_credit.sql`
9. `20261106050000_v5_4_team_monthly_reconciliation.sql`
10. `20261108230000_v57_team_operations_overview.sql`
11. `20261109163000_v5_6_team_refund_correction_ledger.sql`
12. `20261110032000_v5_6_team_allocated_refund_intake.sql`
13. `20261110040000_v5_6_team_direct_refund_approval_reversal.sql`
14. `20261110050000_v5_6_net_settlement_reconciliation.sql`
15. `20261110060000_v5_6_applied_credit_reverse_conservation.sql`
16. `20261110070000_v5_6_parent_finance_verified_bridge.sql`
17. `20261110080000_v5_6_manager_adjustment_sources.sql`
18. `20261110090000_v5_6_allocated_manual_payout_history.sql`
19. `20261110100000_v5_7_team_operations_net_reconciliation.sql`

### 5.3 故障停損與重試規則

- 新增 CI-only `tests/local/v5-migration-atomicity-smoke.sh`：只接受 GitHub Actions、`CI=true`、`V4_E2E_LOCAL=1`、未連結 hosted project 的 `tutor_v4_isolated`；建立短暫故意失敗的合成 Migration，驗證 DDL/DML、history row、V4/V5/Auth 合成資料 fingerprint 均回滾，再以修正後同版號重試並重複 `migration up`，確認只落一筆。失敗檔、測試 table 及測試 history row 由 trap 清理。這項結果僅在 PR #68 新 SHA 的工作流成功後才標 PASS。
- 任何真實 Migration 發生意外 SQLSTATE、history 與預期不一致、schema/catalog 指紋 drift、資料守恆失敗或權限矩陣失敗，立即停止後續 Migration 及前端發布；不可跳過版本、手工改正式 history、猜測 down SQL 或直接重跑整批。
- **正式環境沒有自動 rollback 保證**。先凍結 V5 寫入／關閉功能入口，保留錯誤與稽核證據，唯讀盤點實際 history/schema；由 ChatGPT 在隔離環境重現並提出 forward-fix。原始 append-only 帳務分錄不得刪除或覆寫。需要正式還原時須另經使用者授權及確認還原點、資料遺失窗口與對帳計畫。
- CI 合成錯誤注入不代表正式 Postgres 交易行為、正式備份可用或正式資料恢復已證明；不得把 CI 測試檔拿去 Production 執行。

### 5.4 合成 backup→restore 驗收範圍

- 更新後的 `tests/local/v5-disposable-backup-restore-smoke.sh` 僅在 disposable CI 使用，保留物件原 owner 與 object ACL；ACL fingerprint 同時涵蓋 schema、relation、function owner 及 grants。僅略過 Supabase 受保護角色的 platform `DEFAULT ACL` TOC entries，避免用有限權限角色重建平台預設權限。
- 還原前後比對選定 schema 的 schema-only dump SHA-256（public、tutor_private、auth、supabase_migrations 及其 `extensions` 相依物件；包含表、RLS policies、functions）。CHECK 約束因 PostgreSQL dump/replay 會改變多餘括號呈現，改以 `pg_constraint.conbin` 解析樹指紋比對。另以獨立 ACL fingerprint 對照 schema、relations、functions 的 owner 與 object-level grants，並比對每表 row count + row hash，以及主要 migration/Auth/V4/V5 ledger 數量。只輸出雜湊與摘要，不輸出合成 row 或憑證。
- 此證據只涵蓋指定 schema、object-level ACL/RLS 定義和合成資料一致；platform `DEFAULT ACL`、Realtime、Storage platform object/content 不在此 restore assertion 範圍。RLS/JWT 實際授權仍由獨立 GoTrue/JWT/PostgREST E2E 驗證。Production 備份及正式還原仍 NOT TESTED。

### 5.5 正式 GO / NO-GO 清單

**保持 NO-GO，直到下列項目全部以同一鎖定 SHA 證明：**

- PR #68 最新 Node、isolated PostgreSQL、GoTrue/JWT、Chromium、A1-R3 及新增故障/還原 CI 全部成功；source-lock 完整且未改寫歷史 migration。
- 已確認付款的直接分配更正/退款、預收已抵扣退款、跨帳務月份/科目金額守恆、家長逐學生付款/更正/退款歷史與跨 Team RLS 均有負向和正向測試；原始 append-only 帳本保留。
- 真實 43-history A1-R3 相容性與 19-step 遞進證據可追溯；剩餘正式 DB backup/recovery、外部副作用、正式 Codex GUI 及發布授權須各自列明，不能用乾淨 bootstrap 或 PR checks 取代。
- Production V5 Migration、RLS/Auth、Main merge、Vercel Production deploy、外部通知與銀行退款均須獨立授權。本 PR 目前 Draft，這份作業書不是發布授權。
