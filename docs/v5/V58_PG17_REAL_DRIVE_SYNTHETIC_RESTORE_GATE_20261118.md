# 好好上課 V5.8｜PostgreSQL 17 × 真實 Drive × 隔離還原：合成端到端測試

日期：2026-11-18（台北）。**狀態：開發用 Draft / NO PRODUCTION DB / 不啟用每日備份。**

## 本輪目的與安全邊界

先在完全不讀取 Supabase Production 的情況下，驗證完整同一條流程：

PostgreSQL 17 合成資料庫 → 單次 pg_dump -Fc → age/X25519 加密 →
同一受控 OAuth App 的真實 Google Drive API 上傳 → 重新下載並 SHA-256 校驗 →
僅在 GitHub-hosted Runner 解密 → 銷毀來源 PostgreSQL 17 容器 → 全新、獨立且禁用網路的 PostgreSQL 17 容器 pg_restore →
比對五類資料、帳務金額及 RLS 政策。

這與前一輪「真實 Drive 233-byte 虛構文字加密」及「模擬 Drive 的 PG17 還原」不同：這次測試使用真正 PostgreSQL archive 穿過真正的 Google Drive API。

### 已存在且可沿用的授權

- GitHub protected Environment：v58-gdrive-synthetic（只允許 main）
- Environment Secrets：V58_GDRIVE_CLIENT_ID、V58_GDRIVE_CLIENT_SECRET、V58_GDRIVE_REFRESH_TOKEN（**只使用，不讀出或印出**）
- Environment Variable：V58_GDRIVE_SYNTHETIC_FOLDER_ID（既有 app-owned 合成資料夾）
- 現有主程式：scripts/release/v58-gdrive-synthetic-roundtrip.mjs（維持合成專用）
- 正式 SQL、正式 Supabase、正式付款/學生資料及 Vercel App 都不在測試路徑中

### 這個 PR 新增的內容

1. tests/local/v58-pg17-drive-real-restore-synthetic.sh：同一套測試依 V58_PG17_MODE=mock/real 決定檔案傳輸，其他步驟相同
2. .github/workflows/v58-pg17-real-drive-isolated-restore.yml：PR 可跑無 OAuth 憑證的 mock Docker 隔離還原；main 的 workflow_dispatch 才能使用受保護 Secret 進行真實 Drive 傳輸
3. 本操作手冊

不可在 PR 上使用 production Secrets；env 中有 Supabase 連線/Access Token/PGHOST/PGPASSFILE 等，測試必須拒絕。Docker 只啟動兩個不共用磁碟或網路的 postgres:17 容器，皆設 --network none；來源容器在傳輸前即銷毀，目標容器在解密校驗後才建立。合成資料只有虛構名字、假帳務、假 Auth/Storage metadata 與假 Migration。**沒有正式 Storage 物件，不能用此測試證明 Supabase Storage 復原。**

加密金鑰是在 Runner 每次暫時生成，私鑰只留在該 Runner 的暫存工作目錄；測試結束刪除暫存資料。只有 .age 密文進入 Google Drive 合成資料夾；不刪除上次測試檔。

## 在 PR 上能實際驗證什麼？

pull_request 工作會跑：第一個 PostgreSQL17 容器合成 pg_dump → age 加密 → 刪除來源容器 → mock 複製 → 解密 → 第二個全新 PostgreSQL17 容器 pg_restore → fingerprint 完全一致。此設計證明復原不依賴來源資料庫仍存活。

- 來源與還原目標必須是兩個不同 PostgreSQL 17 實例，且來源在解密還原前已停止與刪除
- 需通過 PG17 版本檢查
- 五類測試 schema／table 及帳務合計 450 分必須一致
- public.students RLS 啟用且政策保留
- 明文 SHA 與下載／解密結果一致
- 沒有進入 Production Secrets、不能存出原始 SQL 到 GitHub Artifacts

這是**模擬傳輸的合成資料庫測試**，不得標成真實 Drive PASS。

## 真正 Drive 傳輸的手動 Gate（尚未取得合併授權）

GitHub Actions 的手動 Workflow 需要先存在 main，且 main 合併會自動觸發 Vercel Production 部署。**本 PR 不可因 CI 成功就擅自合併。**

合併經獨立授權且正式 Main/Production 安全檢查通過後：

1. 在 Actions 選 V5.8 PG17 real Drive isolated restore SYNTHETIC ONLY；
2. 分支 main、safety_ack=SYNTHETIC_ONLY；
3. 手動啟動 protected-real-drive-pg17-synthetic；
4. 確認日誌有「PASS: PostgreSQL17 synthetic dump -> age -> REAL transport -> age decrypt -> isolated PG17 restore」且沒有 SQL 或 OAuth 秘密輸出；
5. 檢查唯一的合成加密檔已存在於專用 Drive 資料夾；記錄 Run ID、Main SHA、密文大小與完整性驗證結論。

**這個 PASS 只能代表核心 PG17 合成資料庫同路徑可還原；不等於 Supabase managed Auth/Storage/RLS/S3 或正式資金資料已完整可還原。**

## 其他三個未完成項目與實施次序

### OAuth 長期授權

目前 Google Cloud OAuth Client 為 External + Testing。Google 官方指出非基本身份 Scope 的 Refresh Token 通常在 7 天後到期。現階段先審查：

- Google Workspace 組織 rapid4grad.com 是否能將 backup-only OAuth 設為 Internal，且授權帳號確實在同一組織；
- 或採合規的 External In production / 驗證路徑；
- OAuth Scope 繼續限制 drive.file，確保 Backup App 建立資料夾和檔案；任何使用者類型、發布狀態與擴權變更先由使用者確認；
- 排程應偵測 invalid_grant / quota / upload failure，不能靜默失敗或把憑證印在日誌。

官方依據：
https://developers.google.com/identity/protocols/oauth2
https://developers.google.com/identity/protocols/oauth2/production-readiness/overview

### 每日自動執行

**目前沒有啟用正式 schedule。** 待 PG17 真實 Drive 合成端到端 PASS、長效 OAuth 實測、正式單一 MVCC pg_dump＋全量 Auth/Managed schema/角色 Restore 能力與秘鑰保管安全審查完成後，再另建 MAIN-only 保護工作，連線 Supabase Production 做只讀備份。

- 避免 PR/PR target 任意程式取得 Production Secrets
- 一次完整一致的 pg_dump -Fc，不用舊版多個非一致的 dump 文件互相拼湊
- Backup runner 只持有 age 公開加密金鑰，永不持有解密私鑰
- 成功上傳後重新讀回 SHA；備份產物不得輸入 GitHub Artifacts/PR 或公開日誌
- GitHub cron 可能延遲或停用，要設立**獨立的缺漏監控／警報**（沒有成功備份也要通知）
- Production SQL63 / Main 其他 V5.8 release 繼續 NO-GO

### 7 日／4 週／6 月保存

PR #83 已建立 scripts/release/v58-gdrive-retention-plan.mjs 與測試。規則為 7 不同 UTC 日／4 ISO 週／6 UTC 月，各取最近有效代表版本，聯集去重。Migration 前備份及人工 Hold 不可自動刪除。

現階段**僅唯讀規劃，不執行 Drive 刪除**；至少最新備份不超過 36 小時，且 45 日內有真正隔離還原成功，才可列出候選供人工審查。只有通過受保護權限分離、完整 Catalog、可復原測試與使用者另一次刪除授權才能設計自動清理。

### 四個分開的驗收狀態

| Gate | 結果 |
| --- | --- |
| OAuth App 合成文字真實 Drive age 傳輸 | 先前 PASS（Run #44239800153） |
| PR 隔離 PG17 合成 archive 模擬傳輸 | 本 PR CI 待驗證 |
| 同一條 PG17 archive → 真實 Drive → 真正隔離 restore | 本 PR 合併 Main 及手動工作前 NOT TESTED |
| Production DB dump → 真實 Drive → 完整 Supabase managed restore | NO-GO / NOT TESTED |

## 發布界線

本 PR **不**變更正式 DB、不建立正式 schedule、不操作 migration 63、不新增 Secret、不啟用 Drive 實際刪除、不合併 PR #82/#83。當 PR CI PASS 後，仍需使用者當次對本獨立 PR 合併 main 並觸發 Vercel Production 部署的明確授權。
