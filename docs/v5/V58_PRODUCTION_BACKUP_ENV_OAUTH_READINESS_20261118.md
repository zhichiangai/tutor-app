# 好好上課 V5.8｜正式備份安全 Environment 與 Google OAuth 長期授權

日期：2026-11-18（Asia/Taipei）。狀態：**DRAFT／NO Production DB DUMP／NO schedule／NO Migration 63**。

## 1. 已有證據與尚未驗證

- GitHub Main：6903029c412116eeac03962373cd6cdf040aaed6（PR #89 合併後核實）。
- Actions Run [44257696039](https://github.com/zhichiangai/tutor-app/actions/runs/44257696039)：切換 OAuth Internal 後，PostgreSQL17 **合成資料**的 age 加密、真實 Google Drive 上傳／下載、全新容器還原 PASS。
- Production：Supabase PostgreSQL17、62 筆 Migration；Vercel READY。
- **上述 PASS 不等於正式 DB 已備份，不等於 Supabase managed Auth/Storage 可還原。**
- 現有受保護合成測試 GitHub Environment：v58-gdrive-synthetic。
- 2026-11-18 使用者提供的 Google Cloud Console 截圖：專案 tutor-app-backup 位於 rapid4grad.com 組織，OAuth 使用者類型已改為 **Internal**；原有 OAuth 憑證在切換後的真實 Drive 合成還原測試仍可用。此紀錄是當時畫面與一次測試，**不是對永久 Token 有效的保證**。
- 2026-11-18 GitHub Action [44285408986](https://github.com/zhichiangai/tutor-app/actions/runs/44285408986) 已建立 app-owned、空白正式 Drive Folder：1BI0K6xk604y2mclqC1QVcjbMgJaWHVg8；synthetic Folder：1hPG9jKIbCmTF6Xo1S1SUmVynug3mljEK；Drive 連接器先前唯讀確認正式 Folder 沒有其他人分享、內容為 0 檔案。
- 使用者在 GitHub v58-production-backup Environment 設定十個非機密 Variables；其中 V58_PRIVATE_KEY_OFFLINE_CONFIRMED=true **僅為使用者聲明**，兩份互相獨立的私鑰備份從副本取回並實際解密的 Codex 證據尚未提供，不能將此欄位視為已驗收。

## 2. OAuth 已切換 Internal，長期運行仍需健康監測

Google 官方文件明定：External + Testing 的 OAuth App，使用非基本身份 scope 時，refresh token 一般 7 天到期。Drive Scope https://www.googleapis.com/auth/drive.file 不是基本身份 scope。**一次成功換 Token 或寫入／讀取 Drive，不代表 7 天後還能使用。**

過去是 External + Testing；這項 7 天風險在此次 User Type 切換為 Internal 後不再直接適用。但任何 Refresh Token 仍可能因帳號、管理政策、撤銷及配額等因素失效。**仍需定期監控與失敗告警**。未來若再調整使用者類型、Workspace 管理政策或 OAuth Scope，須重新評估。

替代路線（記錄供未來 OAuth 架構變更參考，本 PR 不執行）：

1. **Internal**：只有 Google Cloud 專案與備份帳號確實屬於同一 Google Workspace 組織才可行；持有自訂網域不等於具備 Workspace Internal 資格。
2. **External + In production**：若使用個人 Google 帳號，評估正式發布備份專用 OAuth App。維持最小 drive.file scope，依當時 Google 的品牌及 scope 規則確認驗證義務。
3. Workspace 管理者 Trusted override 是有條件替代途徑，不假定此帳號已具備。

User Type、Publishing Status、OAuth Client 更換、新增權限需另外明確決定。本輪只查核與設計，不更改。

官方來源：
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth

### Read-only OAuth 探測

新增 scripts/release/v58-backup-oauth-preflight.mjs；Main-only、手動、使用既有 v58-gdrive-synthetic Environment。只向 Google OAuth token endpoint 進行 Refresh Token 交換，並對**既有合成資料夾**做 Google Drive GET metadata 查詢，驗證 ID、名稱與 mimeType。**不讀取 Production DB、不新增／下載／刪除 Drive 檔案、不列印 Token、Refresh Token 或完整錯誤本文**。

成功只證明目前授權可用，結果仍標記 long_term_token_validity=NOT_VERIFIED。若授權仍是 External + Testing，正式每日自動備份仍 NO-GO。

## 3. 建立獨立 GitHub Environment：v58-production-backup

需具有 Repo Settings 權限者透過 GitHub GUI 建立，因現有連接工具不能建立或安全設定 GitHub Environment Secrets：

現有 GitHub Environment 已由使用者透過 GUI 建立：v58-production-backup；下列是其維護／複核規則。

- **名稱**：v58-production-backup；不要替換已存在的 v58-gdrive-synthetic。
- **Deployment branches**：Selected branches and tags → Branch main，禁止其他 Branch/PR/tags。
- **Required reviewers**：在正式首次備份的手動保護階段啟用（本 Repository 為 public，需確認設定是否可用），若可以應禁止 self-review／bypass。
- **重要衝突**：將來的每日無人值守排程若要執行 secret-bearing job，不能同時永遠等待人工 reviewer。先保護手動 Release，之後獨立審查自動化環境的保護方式與必要的分離權限，未核准前不啟用 schedule。
- **重要行為**：GitHub Workflow 引用不存在的 Environment 可能自動建立一個沒有保護規則的空 Environment。**必須先透過 GUI 配置，才允許啟動它的手動 Job。**

### 只配置非機密 Environment Variables

| Variable | 應填內容 |
| --- | --- |
| V58_BACKUP_PROJECT_REF | vctisuglfoxyuwlvyjee |
| V58_PGHOST | db.vctisuglfoxyuwlvyjee.supabase.co |
| V58_PGPORT | 5432 |
| V58_PGUSER | postgres |
| V58_PGSSLMODE | verify-full（正式 Runner TLS 主機驗證仍需另行測試） |
| V58_AGE_RECIPIENT | age 公鑰，以 age1 開頭；**絕對不是 private key** |
| V58_PRODUCTION_DRIVE_FOLDER_ID | 專用正式加密備份 Drive Folder ID，不可使用合成資料夾 |
| V58_SYNTHETIC_DRIVE_FOLDER_ID | 已驗證之合成資料夾 ID，僅做防混用比對 |
| V58_MAIN_ONLY_PROTECTION_CONFIRMED | 已在 GUI 查證 branch protection 後才填 true |
| V58_PRIVATE_KEY_OFFLINE_CONFIRMED | age 私鑰已離線兩處安全保存並實際解密演練後才填 true |

上述 CONFIRMED 變數是操作者聲明，**不是** GitHub API 或私鑰實際驗證證據。不能因 metadata_pass 就宣稱 Production 備份或還原 PASS。

此階段**不設定正式 DB 密碼、正式 OAuth Secret 或 Refresh Token**。未來設定時只能放在 protected Environment Secrets；正式備份 Runner 使用權限 0600 的短命 PGPASSFILE，密碼不可進入 argv、PGPASSWORD、log、Actions Artifact 或 PR。正式資料庫 Dump 的加密公鑰可在 Runner 使用，私鑰永不進入備份 Runner。

## 4. 本 PR 的最小安全工作流程

.github/workflows/v58-backup-oauth-readiness.yml：

| Job | 限制 | 實際效果 |
| --- | --- | --- |
| offline-no-secrets | PR、無 Environment/Secrets | Node 模擬測試、NO DB、NO Drive |
| protected-synthetic-oauth-readonly | main + workflow_dispatch + READINESS_NO_DB_ACCESS | 使用合成 Environment Secret 做 OAuth Refresh + Drive Folder GET |
| protected-production-env-metadata-only | main + workflow_dispatch + READINESS_NO_DB_ACCESS | 只讀取非機密 Environment Variables 進行格式/隔離檢查；NO DB 憑證、NO Drive OAuth Secret、NO 網路備份 |

Production metadata validator 核對 Supabase Ref、固定 DB host/port/user、verify-full、**精確比對 Codex 提供且使用者確認過的 age 公鑰**（不是只檢查格式；若要輪替需另審）、**精確對照已驗證的正式與合成 Drive Folder ID**（不僅是格式及彼此不同），以及人工保護確認。輸出永遠顯示 production_connection_attempted=false、credentials_inspected=false、production_backup_created=false、restore_tested=false。**Metadata PASS 不等於 Release GO**。程式明確回傳 private_key_recovery_evidence_verified=false、actual_drive_folder_access_probed=false、production_backup_authorized=false；單次 Metadata-only CI 不驗證 GitHub 規則 API、私鑰雙份實際恢復或真實 DB TLS 連線。

PR CI 通過不授權合併 Main；Main 自動部署 Vercel，仍需要當次獨立授權。

## 5. 仍需通過的正式備份 Gate

- Google OAuth 長效方案確定、Cloud Console 畫面核對；至少一次在修改後重新測試讀取及持續健康監控。
- 新 Environment branch restrictions/reviewers 實際確認、age 公私鑰分離及私鑰離線可復原。
- 一次一致的 Production PostgreSQL17 自訂格式快照與 roles metadata；不能把多份不一致 CLI Dump 拼成同一個 snapshot。
- 專用正式 Drive 資料夾只存密文，上傳後重新下載比對 SHA-256；不刪除舊備份。
- 完整隔離還原、Supabase managed Auth、RLS、帳務一致性、Migration；Storage 物件內容本體另行備份與驗證。
- 每日排程缺漏的獨立監測與告警、7 日／4 週／6 月的唯讀保留規則。未授權不啟用刪除。
- Migration 63 需正式備份與隔離還原 Gate PASS 才能執行。

**本輪沒有任何 Production 備份、資料庫修改、OAuth Console 變更、付費資源或每日排程。**
