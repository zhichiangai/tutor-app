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
