# RAP-16｜雲端正式備份候選與 Codex 金鑰／Environment Gate（2026-11-23）

**目前只完成程式候選與無憑證 CI；正式備份仍 NO-GO。這份文件不是備份指令的執行授權。**

## 已開發的雲端候選

保持在 [Draft PR #83](https://github.com/zhichiangai/tutor-app/pull/83)，不合併 Main，不配置或讀取 Production Secrets：

- `.github/workflows/v58-cloud-production-backup-candidate.yml`：只有 `workflow_dispatch`；僅接受 `main` 與精確手動確認；工作必須使用 `v58-production-backup` Environment，不接受 PR 或 schedule。最重要的實際保護，仍要由 Codex GUI **核實**。
- `scripts/release/v58-cloud-production-gate.mjs`：驗證 repo/ref/run attempt、人工已審核 SHA 必須等於執行 SHA、固定 Supabase Ref、DB Host／port／TLS、精確固定 age 公鑰與 Drive 目標 Folder，以及未啟用／不匹配時拒絕繼續。標示為 metadata gate，不代替真正的 GitHub Environment Review 或 K0 解密驗證。
- `scripts/release/v58-cloud-pgpass.mjs`：只能從受保護 Runner Secret 建立單次 `0600` 的 `PGPASSFILE`，不可在 argv／PR／Log 存放密碼。
- `scripts/release/v58-cloud-production-backup-once.sh`：使用 **PG17** 的單一 custom-format `pg_dump`，另行匯出無密碼的 global roles metadata；檢查 Auth／Storage／Migration／app schema 的 Archive TOC、封裝兩個資料來源的校驗值、以 age 公鑰加密後刪除 Runner 明文暫存，再送交 Drive 工具。
- `scripts/release/v58-gdrive-ciphertext-transport.mjs`：串流上傳 age 密文、重新讀取 Drive metadata（確認正確 folder/name/size）、重新下載同一密文，驗 SHA-256。不呼叫 Drive 刪除、不解密、不寫入正式 DB、不宣稱完整還原。
- 無憑證合成測試與合同測試在 `.github/workflows/v58-cloud-backup-candidate-synthetic.yml`，全部使用臨時合成資料／假的 OAuth／DB Password。正式方案的 Script 只可能在經**另外一次** Main 合併與 Manual Release 授權後實際啟用。

**注意**：現有 GitHub Repository 為 public。GitHub 文件指出 GitHub Free 對 *private* Repo 的 Environment protection、required reviewers 並不等價於 public Repo；因此不要逕自改成 private Repo 便假定仍有相同 Release Gate。若考慮獨立 Private 備份 Repo，須先查實當時 GitHub 方案支援的 reviewer／branch protection，並獨立決策。

## Codex Desktop 下一個最小任務（只能唯讀／離線）

Codex 在真正 Mac Host 執行；先讀 `AGENTS.md`、`note/ai-handover/00_START_HERE.md`、`05_DEVELOPMENT_AND_RELEASE.md`、`06_QA_AND_EVIDENCE.md`。**不要安裝 PG17、啟動 Docker、讀取任何正式 DB 或設定新的 Production Secret。**

1. **確認 age 既有私鑰的可恢復性**：只在持有人指定的安全目錄，檢查是否存在合法的 age X25519 identity。不要搜尋／列印私鑰全文，也不要上傳 Identity 檔、螢幕截圖、任何私鑰字串。用 `age-keygen -y <檔案路徑>` 得到**公鑰**，只比較（不必輸出私鑰），是否精確等於既有已審公鑰：

   `age1egjmrjvv7g3p4rp2udc5xtz62wfndzqz2jm67xqfa5mjpvlhxfqqr6z49j`

   目前該公鑰已固定在 Main 的唯讀 preflight。若現有 identity 不符合，**不要擅自切換公鑰**；回報 `K0 BLOCKED`，等待 Owner 決策要尋回原 identity、建立新專用金鑰，或有意採用 SSH Ed25519 recipient 並走受審的金鑰輪替流程。若已有 SSH Ed25519 公鑰只能當可選替代，不能證明解得開前述 X25519 公鑰加密的備份。

2. **兩個不同故障域實際復原演練**：在 Owner 明確同意開啟兩份已保護的私鑰副本後，只用**新生成的虛構文字**做一次 age 加密；副本 A、B 各自解密並對比來源 SHA-256。不得將加密私鑰副本放在 GitHub Secrets、Drive 正式備份資料夾、ChatGPT／Linear；不可把完整本機路徑、可識別個資、私鑰或密碼貼進證據。若無兩份獨立副本，不得宣稱 K0 PASS。可以回報 `副本 A PASS／副本 B PASS／公鑰一致 PASS`，以及不含機密的證據位置。

3. **GitHub GUI 核對 Environment**：檢查 `zhichiangai/tutor-app` 的 `v58-production-backup` 是否實際存在、是否只允許 `main`、是否啟用 required reviewer（及防自我核准／bypass 等可用規則）、誰能修改 Workflow／Env。只記錄狀態，不改設定。尤其必須確認是否有足夠不同審核者，且不會因單人帳號讓正式 Release 卡死。

4. **Google Cloud／Drive GUI 唯讀核對**：核對專用 OAuth Client 的使用者類型、Publishing Status 和最小 `drive.file` Scope；Drive 正式資料夾是否可供該 App 存取且沒有不應有的共享、目前有多少**加密**正式備份檔。不得把 Refresh Token、Client Secret 或 OAuth Code 送到聊天、MD、截圖。Google Drive「連接器可列出資料夾」不等同「GitHub Actions 的 OAuth Client 能存取」。

5. **CI 與權限檢視**：Codex 僅唯讀確認本 PR 最新 SHA 的 7 條相關 Actions，查看新候選腳本；不得把 Draft PR 改 Ready、合併、手動觸發正式 Workflow，也不得修改 GitHub Env vars/secrets、進行 Production pg_dump 或 SQL。

## Codex 回報格式

- Host / AGENTS 及本機規則：PASS／BLOCKED
- 年齡金鑰 K0：原有 X25519 identity 是否存在／公鑰是否相符；離線 A、B 副本恢復：各 PASS／FAIL／BLOCKED
- GitHub Environment 保護：存在、main only、required reviewers、bypass、自審、權限：逐項 PASS／BLOCKED
- OAuth／Drive：唯讀可見性、是否授權 App、是否存在正式密文：PASS／PARTIAL／BLOCKED
- 正式 DB／Driver／Main／Vercel 寫入或變更：**0**
- 遮罩證據：安全截圖位置、時間，不包含敏感字串
- 下一個需要 Owner 獨立批准的操作：如首次設定正式 Environment Secrets、單次 Production 唯讀 dump 等

## 尚未授權及尚未測試

- 受保護 Secrets 目前不可由此 PR／本輪工具核實，不要假稱已就緒。
- `pg_dumpall --globals-only` 在 Supabase 的角色權限與 Server 受管物件完整性尚未實際測試。Docker／PG17 的 CI 合成 PASS 不證明正式 DB 可匯出。
- 現有 Runner 上 PG17 客戶端是否可用、TLS verify-full 是否能成功握手，仍要在未來授權的獨立 Release Gate 做 fail-closed 核驗。
- PostgreSQL Archive 不包含 Storage API 的實際物件位元組；完整 Auth/Storage/Managed Schema 還原、主密鑰與平台設定、帳務數量與 RLS/JWT 驗證仍屬 P2 **NOT TESTED**。
- 不得啟用 schedule、Drive 刪除、Production SQL Migration 63／64、GitHub Main 合併或 Vercel Production 發布；各需另外精確授權。

官方參考：
- <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- <https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments>
- <https://supabase.com/docs/guides/platform/backups>
- <https://github.com/FiloSottile/age>
