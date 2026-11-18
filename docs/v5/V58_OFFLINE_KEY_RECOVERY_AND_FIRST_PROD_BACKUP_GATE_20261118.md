# V5.8 離線私鑰雙副本復原驗收與首次正式備份前置閘門（2026-11-18）

狀態：**Draft / NO Production dump / NO Migration 63 / NO Main merge / NO scheduled job**。

本文件不取代既有 \`V58_PRODUCTION_BACKUP_ENV_OAUTH_READINESS_20261118.md\` 與 PR #83 的發布門檻。這是一份**可驗收的操作程序**；撰寫它不代表兩份備份已測、Production 已備份，或任何正式權限已開放。

## A. 第一階段：驗證兩份實體／故障域獨立的 age 私鑰備份

**只能在持有備份媒體的可信任本機執行** \`scripts/release/v58-offline-age-recovery-check.mjs\`。此腳本以新的隨機合成資料驗證公開金鑰完全相同、用備份副本解密成功。**一次只掛載／使用一份副本**，不可把兩份私鑰複製到同一台未加密磁碟。腳本不能證明實體媒體真的獨立，必須由操作者另行核對。

1. 在受信任的 Mac、啟用 FileVault 的安全工作階段確認 \`node --version\` 至少 22，以及 \`age --version\`、\`age-keygen --version\` 可用。從已審閱的 GitHub Commit 執行腳本；**切勿**從 PR 自動執行任何第三方腳本讀私鑰。
2. 從既有受保護 Environment 的 **公開** \`V58_AGE_RECIPIENT\` 確認正式收件者；只在本機輸入公開金鑰，不在聊天傳私鑰。備份副本 A 僅作**讀取**，如外接媒體不支援 \`0600\` 權限，必須由操作者決定是否可在受保護的加密暫存目錄短暫複製，使用完安全移除；不能放到 repository。
3. 在本機 Terminal（或使用者單獨授權的 Codex 本機私鑰驗收工作階段）指定**檔案路徑，不是私鑰內容**：

   \`\`\`bash
   export V58_RECOVERY_EXPECTED_RECIPIENT='age1...請填既有公開金鑰'
   export V58_RECOVERY_COPY_ID=A
   export V58_RECOVERY_IDENTITY_FILE='/絕對路徑/媒體A/age-identity.txt'
   node scripts/release/v58-offline-age-recovery-check.mjs
   unset V58_RECOVERY_IDENTITY_FILE V58_RECOVERY_COPY_ID
   \`\`\`

4. 完全卸載／收妥 A，改用**獨立媒體與保存位置** B，重新從 B 還原**同一把**私鑰，設定 \`V58_RECOVERY_COPY_ID=B\`、B 的檔案路徑，重跑相同腳本。完成後 \`unset V58_RECOVERY_IDENTITY_FILE V58_RECOVERY_COPY_ID V58_RECOVERY_EXPECTED_RECIPIENT\`。清除臨時身分副本、檢查沒有同步到 iCloud/Drive/GitHub，維持兩份備份分離。
5. **接受標準**：輸出分別為 \`status=PASS,copy=A\` 與 \`status=PASS,copy=B\`、\`configured_recipient_match=true\`、\`synthetic_decrypt=true\`；操作者另外證明 A/B 不在同一媒體／故障域。只記錄上述非機密結果、測試日期與腳本 Commit SHA。任何一步 FAIL 都 **NO-GO**；不可只憑 GitHub \`V58_PRIVATE_KEY_OFFLINE_CONFIRMED=true\` 認定通過。

**安全性**：腳本不使用 Production DB、Drive OAuth、網路或任何真實備份，拒絕 GitHub/CI；不在參數中傳私鑰；只產生短命隨機合成資料，離開時刪除暫存。不要提供私鑰、私鑰截圖、助記詞、完整路徑、加密檔與任何憑證給 ChatGPT。就算兩份成功，也只證明**可解密新的合成密文**，不是 Production Restore PASS。

## B. 第二階段：Production 備份流程的安全審查項目

- 維持 GitHub Main SHA/Production 對照；**不得**把 PR #83 裡的舊 \`v58-private-backup.sh\` 當成正式雲端路徑。該腳本的設計目標與已確認的 GitHub Actions-only 加密備份方案不一致。
- 尚需獨立完成 Production-specific runner 設計與程式碼審查：受保護 Main-only Environment、使用不可輸出到 log 的 Secret、唯讀資料庫權限、\`PGPASSFILE\` 0600、PostgreSQL 17 一次 \`pg_dump -Fc\` 快照；roles/globals 另存且與 DB snapshot 不同時點。
- age **只有公開金鑰**在備份 runner；正式私鑰不進 runner、不進 Repository、不進 Drive。任何明文在 Runner 的存在時間受限，不能產生 GitHub Artifact、PR 附件或原始 SQL log。
- 僅將密文上傳至 app-owned 專屬 Production Google Drive Folder，下載後核對 SHA-256／大小；失敗要 NO-GO 並告警。不能以傳輸成功取代隔離的實際 PostgreSQL/Supabase managed Auth/RLS/RPC/財務對帳還原。
- Storage objects 本體、角色／權限與 Supabase managed schema 需單獨確認；沒有完整還原證據不得稱為「完整 Production 備份」。
- 7 UTC 日／4 ISO 週／6 UTC 月的計畫仍僅唯讀，PR #86 與 PR #83 不應無審查一起合併；沒有刪除 API、沒有自動刪除授權。缺少 36 小時內新備份或 45 天內真實隔離還原一律全部 KEEP。

## C. 第三階段：首次 Production 備份的獨立授權閘門

在 A/B 私鑰均 PASS、Production backup workflow 通過安全審查，且使用者**另外明確批准一次只讀正式 DB 備份匯出與密文傳輸**後，才可在受保護的 Main-only job 中設定所需 Production Secrets 並執行。絕不讓 PR 工作取得 Secrets。

待辦順序：工作環境安全設定 → 一致 pg_dump／安全加密 → 真實專屬 Drive 上傳與取回 SHA → 沒有對外副作用的隔離 PostgreSQL 還原 → 受管 Supabase Auth/Storage/RLS/RPC/帳務對照 → 記錄非敏感證據。**本 PR 不執行任何這些正式操作**。成功前正式備份狀態仍為 NOT TESTED；未來排程與故障告警仍須另審、另核准。

## D. 第四階段：Migration 63 與正式發布保持分開

- 目前 Source-locked Migration 63 在 Draft PR #82，版本 \`20261117010000\`，固定 SQL 仍在 \`supabase/release-candidates/\`，**不是**正在使用的 \`supabase/migrations/\`。
- 當次 Production metadata-only SQL 預檢可在唯讀條件下重跑；通過不等於可套用 SQL。不得跑整包 \`db push\`、\`migration repair\` 或 Production reset。
- **三個不同的高風險許可**：正式資料備份匯出與隔離還原、Production Migration 63、Main 合併與 Production 發布（後兩者亦應分別授權）。
- 正式備份與可還原證據不足時 **Migration 63 NO-GO**，Vercel Production 仍以目前 Main 保持服務。Codex 最終角色 GUI 必須在當次 Production READY/SHA 查證之後進行，Preview 與 CI 不取代正式 GUI。

## 僅能如此回報狀態

- \`PASS\`：有指定 SHA/Run/操作者實際證據
- \`PARTIAL\`：證據覆蓋部分關卡
- \`BLOCKED\`：缺實體私鑰媒體、權限或授權
- \`NOT TESTED\`：本輪未執行

目前已實查的 GitHub 合成工作：#44257696039（合成 PG17 → 真實 Drive → 隔離還原）、#44303100522（正式 Environment metadata only）、#44303365262（OAuth synthetic folder 唯讀）。都**不**等同於 Production DB dump 或完整平台還原。
