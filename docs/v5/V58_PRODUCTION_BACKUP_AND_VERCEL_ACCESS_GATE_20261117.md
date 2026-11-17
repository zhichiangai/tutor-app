# 好好上課 V5.8：Production 正式備份、隔離還原、Vercel API 授權與 Release Gate

日期：2026-11-17（Asia/Taipei）。**正式狀態：NO-GO，不可由本文件推定授權。**

## A. 本次由工具實際查證

- Supabase Production `vctisuglfoxyuwlvyjee`：`ACTIVE_HEALTHY`、organization `rapid4grad` Free、PostgreSQL 17、正式 DB 約 17 MB、62 筆 Migration、last `20261110100000`。
- Production metadata-only SELECT：`storage.buckets = 0`、`storage.objects = 0`、`auth.users = 5`、`vault.secrets = 0`、`cron.job` 表不存在。本次沒有讀取 Auth 個資或 Vault secret 本文。
- 新增可在 Production 與**隔離還原後的測試 DB**分別執行的 **SELECT-only scalar inventory**：`supabase/diagnostics/v58_backup_restore_metadata_readonly.sql`，唯讀執行 PASS；目前 snapshot 為 Auth users 5、students 5、workspaces 4、guardian links 1、payment batches 3、Team projects / lessons / payments / refunds 目前均 0、storage 0、Migration 62、Parent RPC body MD5 `3569963e9d47af5d5e2acc728ccc8f17`。public / tutor_private ordinary tables 中 RLS 開啟 71、未開啟 5；這是**來源庫對照摘要**而非完整備份檔、還原測試或 RLS 安全證明，正式備份建立當下應重新擷取。
- Supabase Free 沒有**可依賴的每日自動備份／PITR**。官方建議自行保護 DB dump：<https://supabase.com/docs/guides/platform/backups>。
- GitHub Main `8cf48e3bfcd0f11638db3141bcf47d89e11e94fe`；V5.8 固定 SQL Review PR [#82](https://github.com/zhichiangai/tutor-app/pull/82) Head `04bd9337888a4f6348b3dc81e7b1b41ebce2118a`，截至本輪檢查其 isolated Node 440/440、兩套 Chromium 各 60/60 與 CLI 62→63 均 PASS。
- Vercel domain API **已獨立取得** `tutor.rapid4grad.com` Verified，Project ID `prj_Mq14CrYpOh42Fe1yhOJ3Ksk1iLMq`，不是 `rapid4grad-website` 的 `prj_myh4jpWjhQKh4oSjSJmB0MDwLdq9`。
- **Vercel API 權限問題已解決（PASS）**：使用者於 ChatGPT Vercel Plugin 的「重新連線」授權畫面，明確把 `tutor-app-v2` 加入所選 Projects 後完成 Authorize。原本專案名稱/ID 查詢 404、部署清單 403；重新授權後，API 以名稱與精確 ID 均可讀取 `tutor-app-v2`、正式網域 Verified、Production `READY`，Production Main SHA `8cf48e3bfcd0f11638db3141bcf47d89e11e94fe` 與 GitHub Main 一致。新增 Preview READY 不等於正式部署；此處只採 `target=production` 的部署為證據。

## B. 維持 Free：新安全方案（PR #83 修訂版）

### 為什麼停用舊版 CLI 七檔案流程

Codex 2026-11-17 的**實際本機盤點**確認，先前 `v58-private-backup.sh` 以 `supabase db dump --db-url <含密碼URL>` 呼叫 CLI，密碼可能進入 subprocess 參數；七份獨立 dump 亦**沒有共享一個 MVCC snapshot**。這兩項是正式備份 **FAIL／BLOCKED**，既有 Node 3/3 PASS 並未測到問題。舊的 `v58-backup-target-flag.mjs` 僅保留為歷史測試工具，**不再是正式備份執行路徑**。

官方根據：PostgreSQL 17 [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) 為一次完整資料庫匯出維持一致的 MVCC snapshot；[PGPASSFILE](https://www.postgresql.org/docs/17/libpq-pgpass.html) 密碼僅存取 owner-only 的 passfile，不放在 `argv`；[pg_dumpall --globals-only --no-role-passwords](https://www.postgresql.org/docs/17/app-pg-dumpall.html) 另存角色中繼資料而不含角色密碼。官方 Supabase [備份與還原](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) 說明受管 Auth/Storage Schema、自訂變動、Migration 與 Storage API 物件需額外注意。

### 正式資料庫唯讀備份（仍未實際執行）

1. 在 Mac 啟用 FileVault，確認可用磁碟空間；使用本機 PostgreSQL **17** `pg_dump`／`pg_dumpall`／`pg_restore`／`psql`。Codex 上輪回報尚未安裝 `psql`，因此此步仍 **BLOCKED**。不要在正式站執行 `db push`、`db reset`、`migration repair`。
2. 在 Git repo **以外**的加密、`0700` 私密父目錄，另外建立**檔案 `0600`** 的 `.pgpass`；其格式為 `hostname:5432:postgres:username:password`。用受保護的本機輸入方式建立，**不能將實際密碼或 URL 放進 shell 參數、環境變數 `PGPASSWORD`、截圖、ChatGPT、GitHub、CI 或 PR**。特別注意 `:` 與 `\\` 在 `.pgpass` 內須正確跳脫；不允許把真實 pgpass 作為測試 fixture。
3. 只設定**非機密**的 libpq 環境變數 `PGHOST`、`PGPORT=5432`、`PGDATABASE=postgres`、`PGUSER`、`PGSSLMODE=require/verify-full`、`PGPASSFILE=/private/path/.pgpass`、`V58_PRIVATE_BACKUP_DIR=/private/new_nonexistent_dir`。直接連線主機只能是 `db.vctisuglfoxyuwlvyjee.supabase.co`、使用者 `postgres`；Session pooler 為 `*.pooler.supabase.com`、使用者 `postgres.vctisuglfoxyuwlvyjee`。**不允許 `V58_PRIVATE_DB_URL`、`PGPASSWORD` 或無法確認的連線覆寫設定。**
4. 人員先在 Mac 執行 `node scripts/release/v58-pg17-credential-guard.mjs`，確認「ref／TLS／port／密碼檔權限／私密目錄」PASS；再檢查 `bash -n scripts/release/v58-private-backup.sh`。安全檢查不會讀出、顯示密碼。
5. 執行 `bash scripts/release/v58-private-backup.sh`，此腳本會以**不包含任何資料庫 URL／密碼的 argv** 執行：
   - `pg_dumpall --globals-only --no-role-passwords --no-password` → `roles.sql`，供角色／ACL 稽核，**與 archive 不是同一個 snapshot**，角色變更仍需凍結／對帳。
   - **單次** `pg_dump --format=custom --no-password` → `production.snapshot.dump`，包含可匯出之**全部非系統 Schema**（而不只是 public），使用 PostgreSQL 內部單一 snapshot；若受管物件權限不足，**直接 FAIL／NO-GO**。
   - `pg_restore --list` 以私密 `private-toc.txt` 檢查 Archive 至少包含 `public`、`tutor_private`、`auth`、`storage`、`supabase_migrations` 的 Schema 內容；未出現必要物件則 **FAIL**，不能強行認定完整。
   - `manifest.json` 針對 `roles.sql` + `production.snapshot.dump` 記錄 SHA-256、大小、開始／結束 UTC、PG17 客戶端版本。只有 **BACKUP FILE INTEGRITY PASS**；完成後仍為 **RESTORE NOT TESTED**。
6. 備份前後執行同一份 Source 唯讀摘要 SQL；若有重要資料／角色或授權變動，停止並檢查。真實 SQL、pgpass、TOC、私人日誌只能留在加密備份位置；至少留存兩份不同故障域的加密副本。PostgreSQL roles／Supabase managed platform 設定、Storage 物件本體、Edge Functions 與第三方 OAuth 設定不會因這份 database archive 自動完整復原。

### 尚未完成事項

- Codex 尚未驗證 PostgreSQL 17 原生客戶端可用（Mac 原先只有 Supabase CLI 2.107.0、Docker Postgres 17.6 映像）。
- `pg_dumpall` 在託管 Supabase 的實際角色權限仍**未驗證**。若無權讀取，停止並研究備援角色中繼資料策略，**不得放寬 Production 權限或將錯誤忽略**。
- 一份一致 archive 可避免「跨七份資料獨立 snapshot」，但 Roles 是另外匯出的全域物件，仍不是完整 Supabase 平台層的零差異快照。

## C. 隔離還原驗收（Production 仍未還原）

1. **先跑 GitHub 一次性 PostgreSQL 17 合成資料完整 `pg_dump -Fc → pg_restore` 測試**：包含 `public`、`auth`、`storage`、`tutor_private`、`supabase_migrations` 合成表及 RLS，目標是完全不同的 disposable database。此測試僅證明核心 PostgreSQL 工具鏈，不代表真實 Supabase Managed Schema 100% 還原。
2. 真實 Production archive（目前尚無）建立後，才能在 Mac **獨立本機 Supabase／Postgres 環境**測試還原；嚴禁把 Production 當目標，禁止接正式 DNS、外部信件、Webhook、付款／通知。若需新的付費雲端實例，先由使用者核准。既有 25 個停止容器與 13 個 Volume 禁止擅自重用、清理、改寫。
3. 還原時先檢查 `pg_restore --list`、roles／extensions、Auth/Storage 自訂 Trigger 與 RLS、現成 Supabase managed Schema 的相依衝突，遵循官方 restore 指引。**不要對已有 Supabase Managed 物件不加審查直接 `--clean`／`--create`／`DROP SCHEMA`。**
   **受管 Schema 注意：** Supabase 官方 [Platform → Self-hosted Restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform) 明確指出，原生 `pg_dump` 會包含 Supabase 受管內部物件，直接還原到既有 Supabase Schema 可能產生權限或重複物件衝突。此單次 Custom Archive 是一致的資料庫快照來源，**不是已經證明可直接部署到新的 Supabase 專案的還原包**；必須在本機隔離 Supabase 做平台層拆分、相依及角色驗證。
4. 來源與隔離庫使用 `supabase/diagnostics/v58_backup_restore_metadata_readonly.sql` 產生 **owner-only 0600 JSON**，運行 `scripts/release/v58-private-restore-parity.mjs`；檢查 62 個歷史版本、20 類 Auth／學生／課程／帳務等筆數、RPC MD5、RLS 數量。此合約只是**必要條件**；另需驗證 FK、真實 business 金額守恆、RBAC/JWT/RLS、使用者身份資料及外部副作用防護。
5. 備份與還原的同樣內容出現在獨立環境、RLS/JWT 確實隔離且完整相關數據無漂移，才可寫 `RESTORE PASS`；否則維持 `PARTIAL/BLOCKED`。任何證據不得包含真實姓名、Email、密碼或帳務原始明細。

## D. Vercel API Project Grant 已完成（2026-11-17 PASS）

- 問題已定位：ChatGPT Vercel Plugin 原先的 OAuth Project Access 只勾選 `rapid4grad-website`，沒有勾 `tutor-app-v2`。Vercel Team 的 Marketplace Integrations 顯示 `No Integrations Installed`，不代表 ChatGPT Plugin 無法重連；正確操作是 **ChatGPT → Settings → Plugins → Vercel → 已連結帳號 ⋯ → 重新連線 → Team Configure**，勾選 `tutor-app-v2` 並按 `Authorize`。
- 使用者已完成上述操作；後續 ChatGPT Vercel MCP 實際驗證：`get_project(tutor-app-v2)` **PASS**、`get_project(prj_Mq14CrYpOh42Fe1yhOJ3Ksk1iLMq)` **PASS**、Team project list 包含該專案、`get_project_domain(tutor.rapid4grad.com)` Verified、`list_deployments(target=production)` **READY**。
- 目前 Production commit `8cf48e3bfcd0f11638db3141bcf47d89e11e94fe`，`githubCommitRef=main`，GitHub Main 相同。**Vercel API 存取 / 對照 Gate PASS**。
- 不需再執行一般 Team SSO 授權，不需安裝 Vercel Marketplace Integration，不需重新建立或移轉專案。這次 Grant 允許 Vercel API 讀寫，**不代表使用者已授權 ChatGPT 直接部署或 rollback Production**。

## E. 正式 SQL 63 與 Main：兩個獨立受控 Gate

- **G0**：Production 62 筆、最新 `20261110100000`、Parent RPC `md5(prosrc)=3569963e9d47af5d5e2acc728ccc8f17`、RLS/匿名 grants/Team Guardian checks 完全相符，並已通過真正的正式備份與隔離還原。
- **G1**：正式 SQL 只允許來源鎖定的 `20261117010000_v58_parent_project_scoped_receivables.sql`（Git blob `572dcbcaa0e2b6d1e7f1cb6fe0e078b93853846f`），Production DB 62→63；原始 43-history 與 repo 舊 V4 編號不一致，**禁止整包 Supabase db push**。取得對「正式 SQL 第 63 筆」的當次獨立授權後，在受保護執行環境進行，升級後再唯讀驗證 63/RPC/授權。
- **G2**：G1 完成、資料庫健康後，取得對「Main 合併且自動 Production 部署」的當次**另一項**授權；不得搶先 Main auto deploy。核對 Main/Production SHA 與 Vercel READY/Domain，最後交 Codex 唯讀 Production GUI 真驗收。
- **任何 G0/G1/G2 不通過都保持 NO-GO**。不得藉由先合併或降低 RLS 繞過安全條件。

## F. 本輪 Release Gate 狀態

| Gate | 結果 |
| --- | --- |
| Repo 固定 63 SQL 及隔離 CI | PASS（PR #82 SHA `04bd9337...`） |
| Production Source/RLS/Migration Metadata | PASS（62，固定 RPC + 20 類非敏感表筆數對照） |
| Storage/Auth/Vault 只讀存在性與筆數 | PASS（快照，不是 backup） |
| Backup 真正 SQL 檔案建立 | BLOCKED：現有連接沒有完整受保護 dump / private storage 的操作介面 |
| 備份完整性／SHA-256 | NOT TESTED：待私密 SQL dump |
| 62 筆正式資料隔離還原 | BLOCKED：尚無正式備份及隔離目標 |
| Vercel Dashboard 專案訪問 | PASS（使用者截圖） |
| Vercel API 專案及部署讀取 | **PASS**：授權 `tutor-app-v2` 後，正式 READY、Main SHA / verified domain 獨立核對 |
| Production Migration 63 | NOT TESTED / NO-GO |
| Main Merge / Production Deployed V5.8 | NOT TESTED / NO-GO |

## G. Codex Mac 本機隔離驗收交接（2026-11-17）

目前已完成同一 Head `40a04ab1424bf5bcc12425c8b30157974e87304b` 的 GitHub Actions：

- [V5.8 private backup tooling synthetic #44012266802](https://github.com/zhichiangai/tutor-app/actions/runs/44012266802)：PASS（僅合成環境與檔案）
- [PostgreSQL 17 single custom archive → restored DB #44012266806](https://github.com/zhichiangai/tutor-app/actions/runs/44012266806)：PASS（合成 users、storage、fees、62-history-shaped sample、RLS；**不是**真實 Supabase）
- [V4/V5 isolated Chromium #44012266819](https://github.com/zhichiangai/tutor-app/actions/runs/44012266819)：PASS（該 Head）

**本機任務只驗證工具與合成受管 Schema，暫不使用正式密碼、不連正式 Database、不產真實備份。**

1. 在 Mac 原獨立 worktree `/Users/fengfeng/.codex/worktrees/v58-backup-safety/家教小網站` 確認工作樹乾淨、PR #83 最新 Head 與本報告一致；若不一致，先安全同步，不覆寫其他工作。
2. 確認 FileVault、至少 25 GiB 可用空間（若不足先停止，不自動刪檔）、Docker Desktop 狀態與原有 Volume/容器清單。**不啟動、不刪除、不重用原本 25 個停止容器及 13 個 Volumes**。
3. 先檢查 `pg_dump --version`、`pg_restore --version`、`pg_dumpall --version`、`psql --version`。缺少才評估 Homebrew `postgresql@17` 客戶端或使用官方 PostgreSQL17 Docker image 的隔離命令；不可在 Mac 安裝未知來源的二進位檔或無故升級已運行環境。各客戶端需 Major **17**，避免將 17.6 與 Production 17.11 的 minor 差異誤當相同環境已驗證。
4. 於**全新**且具獨立標記的臨時 Docker network/container/volume 建立只有合成數據的 PostgreSQL17 測試庫，執行 PR #83 `.github/workflows/v58-pg17-synthetic-dump-restore.yml` 等價測試：Custom Format 單次 dump、角色 metadata 分開匯出、`pg_restore --exit-on-error` 還原到新 DB、確認角色、Schema、資料、RLS。
5. **另行檢驗 Supabase 受管物件衝突**：若使用 Supabase PostgreSQL image/本機 Supabase stack，先只對**新的一次性隔離環境**檢查 Auth/Storage/Extensions/roles 與自訂 trigger/RLS 的 restore 計畫；明確區分 `PostgreSQL17 synthetic PASS`、`Supabase managed schema PARTIAL/BLOCKED` 與 `REAL_PRODUCTION_RESTORE NOT TESTED`，不得以合成測試替代。
6. 所有測試使用虛構本機憑證；任何測試指令／檔案不可引用 `vctisuglfoxyuwlvyjee` 的真實 DB URL、token 或 `PGPASSFILE`。若需要正式來源資料、建立付費雲端專案、動現有 Docker Volume 或任何 Production 寫入，停止該項並回報。
7. 回傳安全摘要：Mac client versions、Docker image tag、工作樹 Head、合成測試 PASS/FAIL、受管 Schema 相容性（已證實／未證實）、錯誤原因、測試容器的處理狀態及可供 ChatGPT 追查的非敏感紀錄。**不貼真實資料／密碼／完整 DB dump**。

完成本機受管 Schema 測試後，才能另行評估 Production 真實私密備份；通過之前，G0/G1/G2 維持 NO-GO。
