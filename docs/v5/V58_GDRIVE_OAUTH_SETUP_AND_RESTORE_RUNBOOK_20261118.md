# 好好上課 V5.8｜Google OAuth 設定、合成測試與隔離還原操作手冊

日期：2026-11-18。狀態：**SETUP REQUIRED / NO PROD / NO MERGE**。

本文件供未來授權管理人員操作，不包含實際憑證。Google Drive PoC 與 7／4／6 設計詳見：
- V58_GOOGLE_DRIVE_ENCRYPTED_BACKUP_POC_20261118.md
- V58_GDRIVE_BACKUP_7_4_6_POLICY_20261118.md

## A. 服務組合

現階段 Supabase Free + GitHub Free + Google Drive；Google Drive 存放密文，GitHub Actions 提供短暫備份執行，不將明文 DB 或私鑰寫到 Git。未來若升級 Supabase Pro，官方備份與 Google Drive 分屬兩個備援來源。

## B. Google 帳號與最小授權（需使用者本人操作）

1. 使用要保存備份的 Google 帳號，建立/選定專屬 Google Cloud Project（Google One 儲存付費不自動包含 Google Cloud 運算費用）；啟用 **Google Drive API**。
2. 為此備份工作建立**專用** OAuth Client、Consent Screen，僅要求 Drive API 的 drive.file 範圍；確認 Google 的驗證、Testing/Production Refresh Token 有效期、應用程式發佈狀態。
3. 一次性透過可信賴的 OAuth Authorization Code Flow 進行 offline 授權，安全取得 Refresh Token。**本 Repo 尚未提供可審核的 OAuth 授權碼交換 UI/CLI；在它完成且驗證前，不要求使用者在聊天貼任何 Token。**
4. 在同一 OAuth App 授權下建立專用**合成測試**資料夾，確認 App 能讀寫該資料夾；聊天中的 Drive Connector 建立的資料夾**不能假設**自動授權給新 App。
5. 真正備份與還原所需 age 公私鑰必須另行規劃；正式備份 Runner **只放公開收件者金鑰**，私鑰不得放入 GitHub、Google Drive 或同一帳號的備份資料夾。
6. **不可**使用個人主要帳號密碼、Service Role Key、Supabase DB URL 直接貼入 GitHub PR / ChatGPT 訊息。

## C. GitHub Actions 合成 Drive 測試（完全不接正式資料）

規劃的 GitHub protected Environment 名稱：v58-gdrive-synthetic。**目前尚未配置、未啟動。**

- GitHub Environment Secrets：V58_GDRIVE_CLIENT_ID、V58_GDRIVE_CLIENT_SECRET、V58_GDRIVE_REFRESH_TOKEN。
- GitHub Environment Variable：V58_GDRIVE_SYNTHETIC_FOLDER_ID（由相同 OAuth App 建立／授權的專用合成資料夾）。
- 工作流程：.github/workflows/v58-gdrive-synthetic-oauth-roundtrip.yml。
- 程式：scripts/release/v58-gdrive-synthetic-roundtrip.mjs。
- 合成 API 單元測試：tests/v58-gdrive-synthetic-roundtrip.test.mjs。

**安全限制**：工作流程僅支援手動 workflow_dispatch，必須由 main 啟動並選 SYNTHETIC_ONLY；不在 pull_request 執行，不接觸 Supabase Production。它生成臨時 age keypair、加密虛構文字、真實 Drive API 上傳密文、再下載校驗 SHA、解密比對原文。每次測試會在專用 Drive 資料夾留下一份**合成加密檔**；目前沒有刪除程序，需另行管理。

正式 Main 目前尚未包含該 Workflow；PR #83 是 Draft，**不得為了測試而直接合併 Main 或啟用正式備份憑證**。待工作流程與安全審查及另一次發布授權後，才可實際手動觸發。

**測試範圍提醒**：這個合成 Drive OAuth workflow 使用虛構文字，不是 PostgreSQL dump；另一個既有 Workflow 已有真正 PG17 合成 archive/age/隔離還原，但只使用 mock Drive。兩個測試即使都通過，**不代表 PG17 dump + 真實 Drive + 隔離 Restore 的同一條端到端測試已完成**。那是下一個必要 Gate。

## D. 正式每日排程（尚未實作／尚未授權）

先完成單一合成 PostgreSQL17 archive -> age -> 真實 Drive API -> 下載校驗 -> 真正 pg_restore，再審核新的正式 Job、受保護分支與 Secrets 分隔、缺漏提醒與 log 防洩漏策略。絕不讓公開 PR 接觸 Production Secret。連線 PostgreSQL 使用 TLS / PGPASSFILE 等，禁止明文 password URL 出現在 argv 或日誌。

正式上線前還須實際確認託管 Supabase 可匯出哪些 Managed Schema/Global Roles，以及能否在獨立 Supabase 環境恢復 Auth、RLS、Migration History 和金融資料。Database dump 不含 Storage API 物件的實際內容。

## E. 若需要從 Google Drive 還原

1. 選擇同一系統保留的有效密文版本，記下 SHA-256、byte size、備份時間及來源；確認對應 age 私鑰能安全使用。
2. **只在隔離環境**下載密文並計算 SHA，與 Catalog 比較；解密後以 PostgreSQL17 pg_restore 檢查 TOC，再還原到可丟棄資料庫。真實資料演練時封鎖外部 Email、Webhook、付款服務。
3. 驗證 table count、外鍵／資料結構、已確認付款不可改、收款分配、帳務總額、Auth／權限、RLS/JWT、Migration、RPC、Extensions 與 Storage 對應檔案。角色／Managed Schema 相依性不可直接用 --clean 破壞。
4. 記錄環境、來源時間、SHA、驗證項目與差異，**不可在未審核前還原到 Production**。當前真實 Supabase 完整還原驗收仍 NOT TESTED / NO-GO。
5. 若將來使用 Supabase Pro，日常故障可優先評估官方備份，但仍須保留 Google Drive 獨立備份和定期演練。

## F. 現在仍未完成

- Google OAuth App 合法長效授權、Drive 專用資料夾、安全 Tokens／Secrets。
- 真正 GitHub Actions -> Drive 合成檔上傳／下載成功證據。
- 一條 PG17 合成 dump 到真實 Drive 再隔離恢復的整合 Gate。
- Production 讀取備份權限、真正 Production 端到端備份及真實隔離 Supabase 還原。
- 每日正式排程、缺漏警報、7／4／6 實際清理（目前只能提出唯讀計畫）。
- SQL Migration 63、Main 合併與 Production 部署，全部繼續 NO-GO。

所有憑證只應由使用者在已核實的 Google/GitHub 安全管理介面設定，禁止貼到聊天或公開程式碼。
