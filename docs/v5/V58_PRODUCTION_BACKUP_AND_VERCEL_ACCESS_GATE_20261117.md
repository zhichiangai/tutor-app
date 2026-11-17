# 好好上課 V5.8：Production 正式備份、隔離還原、Vercel API 授權與 Release Gate

日期：2026-11-17（Asia/Taipei）。**正式狀態：NO-GO，不可由本文件推定授權。**

## A. 本次由工具實際查證

- Supabase Production `vctisuglfoxyuwlvyjee`：`ACTIVE_HEALTHY`、organization `rapid4grad` Free、PostgreSQL 17、正式 DB 約 17 MB、62 筆 Migration、last `20261110100000`。
- Production metadata-only SELECT：`storage.buckets = 0`、`storage.objects = 0`、`auth.users = 5`、`vault.secrets = 0`、`cron.job` 表不存在。本次沒有讀取 Auth 個資或 Vault secret 本文。
- Supabase Free 沒有**可依賴的每日自動備份／PITR**。官方建議自行保護 DB dump：<https://supabase.com/docs/guides/platform/backups>。
- GitHub Main `8cf48e3bfcd0f11638db3141bcf47d89e11e94fe`；V5.8 固定 SQL Review PR [#82](https://github.com/zhichiangai/tutor-app/pull/82) Head `04bd9337888a4f6348b3dc81e7b1b41ebce2118a`，截至本輪檢查其 isolated Node 440/440、兩套 Chromium 各 60/60 與 CLI 62→63 均 PASS。
- Vercel domain API **已獨立取得** `tutor.rapid4grad.com` Verified，Project ID `prj_Mq14CrYpOh42Fe1yhOJ3Ksk1iLMq`，不是 `rapid4grad-website` 的 `prj_myh4jpWjhQKh4oSjSJmB0MDwLdq9`。
- **Vercel API 權限問題已解決（PASS）**：使用者於 ChatGPT Vercel Plugin 的「重新連線」授權畫面，明確把 `tutor-app-v2` 加入所選 Projects 後完成 Authorize。原本專案名稱/ID 查詢 404、部署清單 403；重新授權後，API 以名稱與精確 ID 均可讀取 `tutor-app-v2`、正式網域 Verified、Production `READY`，Production Main SHA `8cf48e3bfcd0f11638db3141bcf47d89e11e94fe` 與 GitHub Main 一致。新增 Preview READY 不等於正式部署；此處只採 `target=production` 的部署為證據。

## B. 維持 Free：建立真實、私密的正式資料庫邏輯備份

Supabase 官方：<https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore>；CLI 只把 DB dump 到本機，**不會備份 Storage API 物件本體、Edge Functions／Auth provider 設定／域名／API Keys**。現階段 Storage 物件數是 0，但上線前仍須重查。

**重要：目前只有操作腳本與驗證工具，尚未取得實際備份檔。全部步驟必須在有權限的受保護操作者電腦或安全環境執行；不得貼 DB URL、密碼、dump、auth 資料、token 到 ChatGPT／GitHub／PR／Actions log。**

1. 啟用 Mac FileVault 或使用加密私密磁碟。私人工作樹另開乾淨的 Terminal（不能使用 GitHub Actions），事先安裝官方 Supabase CLI **v2/v3（v4 及未知版本拒絕執行）**、Node 22；使用 **Supabase Dashboard → Database → Connect** 的 Session Pooler `5432`，組裝指向 `vctisuglfoxyuwlvyjee` 的、`sslmode=require` 連線 URL。密碼從安全密碼管理器取得，僅在私密 Terminal session 的 env 設定；**不要**貼到 PR/聊天或 shell history。
2. 進入本 PR Review Branch 的 repository root。設定 `V58_PRIVATE_BACKUP_DIR` 為 **不存在、Git repository 之外**的加密位置絕對路徑（父目錄先建立、權限僅操作者），`V58_PRIVATE_DB_URL` 為**僅限這次私密操作**的 Supabase 連線 URL。此環境變數仍會傳遞給 CLI；CLI 連線字串可能在本機程序清單可見，因此僅在受信任單一使用者電腦操作，結束立即 unset。啟用 SQL 日誌時，只寫入受保護的備份資料夾。
3. 執行 `bash scripts/release/v58-private-backup.sh`：先核驗 ref／TLS／DB 名稱／port／新資料夾／禁止 CI。**CLI v2** 明確使用 `--db-url`、**CLI v3** 明確使用 `--remote=<url>`；已以安全的純邏輯測試檢查版本選擇，腳本不會直接將完整 URL 印在標準輸出。此後由官方 CLI 分別備份 `roles.sql`、`schema.sql`、`data.sql`、`auth_data.sql`、`storage_data.sql`、`history_schema.sql`、`history_data.sql`。如有失敗直接停止，不得誤標 PASS。
4. 驗證 **全部來源有實際 `auth.users`、Migration 62 筆、Schema/RLS/RPC/自訂權限、必要資料**，並確認重複來源表不造成還原時重複匯入。執行 `node scripts/release/v58-private-backup-manifest.mjs verify ABS_PRIVATE_BACKUP_DIR` 檢查 7 份 SQL SHA-256 與權限。這項檢查成功只代表**檔案完整性**，不是還原成功。
5. 至少存兩份獨立故障域、加密、存取受限的備份。只有 **檔名、bytes、sha256、UTC 時間、DB 版本、備份工具版本、restore test PASS** 可用於交接；不可將原始 SQL 上傳公共或共享檔案。

## C. 真正隔離還原驗證：必需，尚未執行

- 建立可控、不能連接正式網域、不會對外寄信或寫入正式 API 的**獨立測試 Supabase/PostgreSQL**。若需要新雲端專案、付費加值或 Supabase branch，必須先取得使用者對費用的同意。可優先使用本機一次性 Docker。
- **絕不**對 `vctisuglfoxyuwlvyjee` 執行 `restore_project`、`db reset`、`migration repair` 或 `db push`；也不得用其現存 Production 當還原目標。
- 依官方文件依角色、Schema、Data 及必要 Auth／Storage Data 與 62 筆 `supabase_migrations` 歷史還原，確認其中 managed schemas 重複匯入、platform extensions 與 FK/trigger 的相依順序。若有自定 `auth`/ `storage` triggers/policies，單獨檢查。禁止複製任何可能導致外部寄信、webhooks、收款、排程的啟動設定。
- 復原驗證要比較還原前 Production 的安全摘要：migration **62**、末版 `20261110100000`、Auth user **5**、Storage bucket/object **0**（這是本次快照，正式試驗時需重查）、主要工作區、學生／家長連結、課程、帳務／退款各類資料筆數與金額總和、RLS policy、匿名權限、RPC body hash、索引/約束；**只保留不含真實資料的摘要**。
- 恢復端 RLS、Team/Guardian 存取權限測試 PASS，實測資料彙總守恆，合格且有可追溯非敏感證據後，才可標記 `BACKUP_RESTORE_PASS`。存檔和 checksum-only 成功不得標記還原 PASS。
- 如果還原仍有遺漏：停在 NO-GO，找出 schema/roles/auth/history 缺口，不得直接升級 Production。

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
| Production Source/RLS/Migration Metadata | PASS（62，data read-only） |
| Storage/Auth/Vault 只讀存在性與筆數 | PASS（快照，不是 backup） |
| Backup 真正 SQL 檔案建立 | BLOCKED：現有連接沒有完整受保護 dump / private storage 的操作介面 |
| 備份完整性／SHA-256 | NOT TESTED：待私密 SQL dump |
| 62 筆正式資料隔離還原 | BLOCKED：尚無正式備份及隔離目標 |
| Vercel Dashboard 專案訪問 | PASS（使用者截圖） |
| Vercel API 專案及部署讀取 | **PASS**：授權 `tutor-app-v2` 後，正式 READY、Main SHA / verified domain 獨立核對 |
| Production Migration 63 | NOT TESTED / NO-GO |
| Main Merge / Production Deployed V5.8 | NOT TESTED / NO-GO |
