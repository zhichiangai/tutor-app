# V5.8｜正式加密備份 Google Drive 空白資料夾安全建立 Gate

日期：2026-11-18。狀態：Draft；僅建立空資料夾；**不做正式備份**。

## 背景與既有證據

- Main：647f54f3c9dd2d09f0805e3dd2a5c59caf698c06；最新合成 PG17 真實 Drive 往返／隔離還原 PASS：Actions Run 44257696039。
- 既有受保護 GitHub Environment：v58-gdrive-synthetic（Google OAuth Internal，既有 refresh token 真實測試 PASS）。
- GitHub Environment：v58-production-backup 已由操作者建立，設定僅允許 main。已填入非機密 metadata 與 age 公鑰，但沒有 Production Secret。
- **私鑰雙獨立副本還原的證據尚未透過 Codex 驗收**。Environment Variable V58_PRIVATE_KEY_OFFLINE_CONFIRMED 值為 true 只是操作者聲明，不能當作 PASS。

## 選擇 app-owned Folder 的原因

Google Drive drive.file scope 只賦予 App 對它所建立或使用者明確透過 Picker 授權的檔案／資料夾的存取權。直接在 Drive 網頁手動建立的資料夾，不一定可由目前 OAuth App 存取。官方：
https://developers.google.com/workspace/drive/api/guides/api-specific-auth

此 PR 使用**現有通過測試的 OAuth App**，透過 Drive API 建立唯一、空白的正式加密備份資料夾：

- 資料夾名：tutor-app-v58-production-encrypted-backups
- Folder 標記：appProperties.v58_kind=production_encrypted_backup_folder
- 明確不同於既有：tutor-app-v58-synthetic-only
- 只列出此名稱的 app-visible Folder；遇到多份或同名但標記不符，一律失敗並要求人工檢查
- 如果已存在經同 App 建立且帶有正確 marker 的 Folder，就重複使用其 ID，不建立第二個
- 新建後使用同一 OAuth App 回讀並核對 ID、名稱、mimeType 及 marker；使用 ignoreDefaultVisibility=true 避免套用組織預設檔案可見度（仍需在 Drive UI 另確認分享設定）
- 只輸出 opaque Folder ID、created、production_backup_uploaded=false、production_database_accessed=false

## 動作與權限邊界

Workflow：.github/workflows/v58-gdrive-production-folder-bootstrap.yml

1. PR 只跑離線無 Secret 的 Mock Drive CI；不接觸 Drive。
2. 只有**Main** 的 workflow_dispatch + safety_ack=CREATE_EMPTY_FOLDER_ONLY 才啟動實際 Job。
3. Job 重用現有 v58-gdrive-synthetic Protected Environment 的 Drive OAuth Secrets，僅為一次性的 Folder 建立；不讀取任何 Production DB Secret，也沒有 Production age 私鑰。
4. 腳本禁止提供檔案路徑，沒有任何上傳備份、下載備份、刪除、分享、排程或 Migration 程式碼。
5. 使用者需另行授權將此 PR 合併 Main（Main 自動觸發 Vercel 正式部署）。**未授權不可合併。**
6. 啟動後從 Actions Log 取得 production_folder_id；在 v58-production-backup 的 Environment Variables 增加 V58_PRODUCTION_DRIVE_FOLDER_ID。
7. 保留原合成 Folder ID 並設定 V58_SYNTHETIC_DRIVE_FOLDER_ID，讓未來 PR #87 metadata gate 確認兩者不同。

## 正式備份仍 NO-GO

此 Folder bootstrap 使用與 synthetic 同一 OAuth 憑證，**故只是 Drive 資料夾邏輯隔離，不是 OAuth 權限或 Google 帳號層級隔離**。正式資料加入之前應另外確認是否採不同 OAuth Client／專用備份帳號，及 Drive 上誰能存取備份內容。即使資料經 age 加密，不能宣稱真實資料已受完整授權隔離。

正式資料加密上傳、GitHub 受保護 Environment Secrets、DB 一致性 dump、Storage 物件本體、隔離還原、雙副本離線 age 私鑰驗收、監控排程都需要另行通過 Gate。

當前這個 PR **只建立空資料夾功能**，沒有資料庫存取，也不改任何正式站前端或 Supabase Schema。
