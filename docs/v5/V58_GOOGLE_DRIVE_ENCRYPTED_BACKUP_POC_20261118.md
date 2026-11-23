# 好好上課 V5.8｜Google Drive 加密雲端備份 PoC（2026-11-18）

> **狀態：PARTIAL／實驗性設計。正式 Production 備份仍 BLOCKED，Migration 63、Main Merge 與 Vercel Production 部署皆 NO-GO。**
>
> 這是使用者選定「Google Drive 加密備份、Mac 不持久保存資料」後的新方向。**不要**因本 PoC 通過而移除原有安全發布門檻，也**不要**直接啟用 CI 的正式資料庫憑證。

## 目的

讓 GitHub Actions 的一次性雲端執行環境從 Supabase **唯讀**匯出 PostgreSQL 17 一致的 Custom Archive，在**上傳前**以成熟的 age/X25519 加密，只把密文及不含個資的完整性中繼資料上傳使用者 Google Drive。受保護的解密私鑰不得出現在備份 GitHub Actions、Git Repository 或同一個 Drive 資料夾。Mac 完全不用保存備份或安裝 PostgreSQL 客戶端。

## 已實際完成的兩個**分開**的合成測試

| 證據 | 結果 | 限制 |
| --- | --- | --- |
| [GitHub Actions #44227148202](https://github.com/zhichiangai/tutor-app/actions/runs/44227148202) | **PASS**：Docker PostgreSQL 17 合成 Custom Archive → age X25519 加密 → 僅密文複製至**模擬** Drive 目錄 → 驗證 SHA-256 → 解密 → 真正隔離 PG17 還原，資料／RLS 一致 | **沒有**呼叫真實 Drive API；使用該次 CI 產生的暫時測試私鑰，不能用來還原任何日後真實備份 |
| Google Drive 真實加密檔上傳／下載 | **PASS**：使用連接的 Drive，在 [專用測試資料夾](https://drive.google.com/drive/folders/1-2bh9riCqKpLIXERV05-MXxikxG-W3nC) 上傳 [141-byte 合成 AES-256-GCM 密文](https://drive.google.com/file/d/1rmpyGtYJgoUmdtbuZjsWposKZR4OTC9n/view)，重新下載後 SHA-256 與來源完全一致，解密還原原始合成文字 | **不是** GitHub Actions 透過自己的 OAuth 上傳；它使用聊天端已連線的 Google Drive 授權，且只是合成文字而非真實 SQL 檔 |

加密檔 SHA-256：`a72f498b1518463557958d173ff8862df30a7f5b79d3a5ad8d83275169f3df80`，大小 141 bytes。檔案只包含虛構文字、不含 Supabase 憑證或任何正式資料。

**重要：上面是兩個獨立成功的測試，不能合稱「GitHub Actions → age → 真實 Google Drive → Production Restore」已通過。** 最終正式流程一律採選定且可重複還原的單一加密格式（建議 age），不能混用實驗用 AES-GCM 格式。

## 建議的正式架構（尚未建置／尚未授權）

1. **觸發與隔離**：新增獨立 **Production-only** GitHub Actions 工作，只在受保護的 `main`、`workflow_dispatch` 或排程執行；禁止 `pull_request`、`pull_request_target` 或任意 PR Commit 取得正式 Supabase／Google Secrets。使用 GitHub protected Environment + 必要核准，預設 `permissions: {contents: read}`。
2. **資料庫連線**：環境 Secret 存放必要的 libpq PGPASSFILE 內容，Runner 只在 `0700` 私密工作目錄建立 `0600` 密碼檔；連線目標非秘密參數使用 `PGHOST`、`PGPORT`、`PGUSER`、`PGSSLMODE`。**不傳含密碼的 URL 至 CLI argv**；確認 GitHub-hosted Runner 對 Supabase direct IPv6 的限制，必要時用經確認的 Session Pooler (port 5432) 並重查 SSL/TLS。
3. **原始封存**：固定 PostgreSQL 17 版 `pg_dump -Fc` 單次取得 SQL DB 一致的 snapshot；roles／權限另保存已去除角色密碼的中繼資料，留意它與單次 DB snapshot 不具跨檔原子性。Auth/Storage/Managed Schemas、Migration History、Extensions 不可略過；Storage 物件本體另備份。
4. **備份加密**：以版本固定且來源可信的 `age`，使用 **僅公開收件者 Key**（Public Recipient）加密；Private Key 只在獨立復原保管機制，**不在**備份 runner／GitHub Secrets／Drive。確保只有密文跨越 Google Drive 邊界，成功上傳後清除 runner 暫存檔。記錄密文 SHA-256、大小、版本、開始／完成 UTC 及無敏感內容的 catalog。
5. **Google Drive 授權**：個人 My Drive 用獨立 OAuth Client，由**使用者一次**安全登入授權，建議要求最小 `https://www.googleapis.com/auth/drive.file` 權限。備份專用資料夾應由**同一個 OAuth App 建立**，而不是認定聊天端的 Drive 連線或其他 App 建立的資料夾自動可存取。Runner 的 Client ID、Client Secret 與 Refresh Token 由 GitHub protected Environment Secrets 管理，不得貼進聊天、PR 或 CI 日誌。Google OAuth 外部 App 若停留在 **Testing** 狀態，一般 Refresh Token 可能 7 天到期，須依官方文件規劃合法的長效授權和撤銷機制。
6. **不可把 Drive 當資料庫**：Drive API 使用 resumable upload，檔案上傳後應重新下載／比對密文 SHA-256；**存成功不等於還原成功**。設定版本保留、空間上限、額外異地副本、告警與資料保留政策，避免誤刪與帳號被盜時一併損失所有備份。
7. **雲端還原演練**：以另一套一次性**受保護且與正式站完全隔離**的環境取得 Private Key，解密並完成完整 Supabase 分層還原（Auth/Storage/實際 62 筆 Migration/Extension/RLS/JWT/帳務）。保護敏感資料、封鎖外部 Email/Webhook/付款副作用。沒有此證據時 **Full Restore 仍 NO-GO**。

## 還沒完成的關卡

| Gate | Status |
| --- | --- |
| age 加密 → 模擬雲端儲存 → 真正 PG17 合成還原 | **PASS** |
| 真實個人 Google Drive 加密合成檔上傳／下載／解密 | **PASS** |
| GitHub Actions 直接取得獨立 Drive OAuth 並上傳 age 加密檔 | **BLOCKED／NOT TESTED**（需要使用者 OAuth 一次授權與安全密鑰保管） |
| GitHub Actions 使用正式 Supabase 連線執行 PostgreSQL 17 dump | **NOT TESTED／無當次正式授權** |
| Production 資料上傳 Google Drive | **NOT TESTED** |
| 真實 Production 密文下載、解密、隔離 Supabase Full Restore | **NOT TESTED** |
| 變更原有 V5.8 發布 Gate／Migration 63 | **NO-GO，仍以原有發布文件為準** |

## 正式接線前所需的操作

- 不必再在 Mac 建 `.pgpass` 或保存任何正式備份資料；但**雲端 runner**必須透過保護的 Secret 安全持有資料庫唯讀備份權限，這只把機密保管由本機移到雲端，不代表免授權。
- Google Drive Connector 在聊天可上傳檔案，**不會**自動授權 GitHub Actions 使用同一 Google 帳號。需用 Google Cloud OAuth Consent Screen／Drive API 為自動化流程建立專用、可撤銷的授權。
- 先以獨立 OAuth 在正式 Drive API 上完成一份**加密合成 SQL**檔案的上傳、下載、解密及真正 PG17 Restore，且 CI 保護與解密私鑰保管審查通過後，才能提議把 `V58_PRODUCTION_BACKUP_AND_VERCEL_ACCESS_GATE_20261117.md` 的「Mac 執行」發布路徑改成「雲端執行」。
- 仍不能讓未經完整驗收的資料庫正式 Migration 63 進入 Production。

## 官方依據

- [Supabase Free Backup FAQ](https://supabase.com/kb/faqs/platform/free-plan-backups)；[Supabase GitHub Actions 自動備份](https://supabase.com/docs/guides/deployment/ci/backups)；[Supabase 平台還原限制](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Google Drive 最小 OAuth 範圍](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)；[OAuth Testing 狀態 Refresh Token 有效期](https://developers.google.com/identity/protocols/oauth2)；[Google Drive Resumable Upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [GitHub Actions compromised runners](https://docs.github.com/en/actions/concepts/security/compromised-runners)


## 2026-11-18 使用者已確認：免費方案與 7／4／6 保留（開發中）

**決策已確認，執行仍未啟用。** 使用 Supabase Free＋GitHub Free＋Google Drive；未來轉 Supabase Pro 時，保留官方 DB 備份及 Google Drive 加密異地副本，避免單一平台故障。GitHub Actions 是執行引擎，不是正式備份儲存庫。初期不引入 GAS 備份引擎，也不新增固定費用的 Cloud Run。

- 每日保留 7 個不同 UTC 日期、每週 4 個不同 ISO 週、每月 6 個 UTC 月份的最新版；三組取聯集，重大 Migration 快照與人工保留標記不自動淘汰。
- 已新增 scripts/release/v58-gdrive-retention-plan.mjs：**純離線、無刪除 API** 的 fail-closed 計畫器。尚未連上 Drive，不能宣稱已經自動執行 7／4／6 清理。
- 只有最近 36 小時有完整加密上傳校驗成功的備份，且 45 天內通過隔離真實還原，才可產生供人工審閱的退休候選；任何不符條件均 KEEP。預設不刪除。
- 對真正的 Production 備份，仍需專用 Google OAuth、受保護 GitHub Secrets、端到端合成 SQL Drive 傳輸測試、真實資料庫唯讀導出授權、真實隔離還原證據。**PR #83、Migration 63 與正式部署仍 NO-GO。**

完整規格與還原優先序：[V58_GDRIVE_BACKUP_7_4_6_POLICY_20261118.md](V58_GDRIVE_BACKUP_7_4_6_POLICY_20261118.md)。
