# RAP-16｜GitHub Actions 雲端優先加密備份候選（2026-11-23）

**狀態：CLOUD-FIRST ARCHITECTURE ACCEPTED / SYNTHETIC-ONLY REVIEW / PRODUCTION BACKUP BLOCKED。**
本文件是 PR #83 的補充，不取代既有 Migration 63/64 發布 Gate；不授權任何正式 DB 匯出、Auth/RLS 異動、Drive 正式備份上傳、Main 合併或 Production 部署。

## 1. 分工更新（不再依賴 Mac PG17/Docker）

- **GitHub Actions**：執行短生命週期 PostgreSQL 17 `pg_dump -Fc`、age 公鑰加密、只有密文可跨 Google Drive 邊界、SHA-256 下載驗證，以及隔離 Restore。
- **Supabase Production**：只允許經核准的唯讀邏輯備份連線，維持既有 62 筆 Migration，尚未發布候選 63/64。
- **Google Drive**：正式專用資料夾只存密文、非敏感 manifest/校驗資訊。7 日、4 週、6 月保留仍是**唯讀規劃**；不得自動刪除。
- **Mac／其他受信裝置**：只需離線持有、雙重備援與定期實際試解密的 age 解密身分；**不要求** Mac 具備 PG17、Docker daemon 或本機備份工作樹。
- **Codex**：金鑰/帳號 GUI 唯讀確認及 Production 功能驗收；不複製私鑰或完整憑證到聊天、Linear 或 CI。

## 2. 已存在的合成證據，不重做

- Main：`.github/workflows/v58-pg17-real-drive-isolated-restore.yml` + `tests/local/v58-pg17-drive-real-restore-synthetic.sh` 可執行 PG17 → age → mock Drive → 獨立 PG17 Restore；僅在 **main / workflow_dispatch / synthetic Environment** 情況可使用真正 Drive API，仍只傳合成密文。
- PR #83：`tests/local/v58-gdrive-encrypted-backup-poc.sh` 可在 Docker `--network none` 內以虛構資料完成 PG17 Custom Archive、age、mock Drive 與隔離 Restore；`tests/local/v58-managed-state-two-stack.sh` 已涵蓋合成 GoTrue/Auth、Storage API 物件與 Migration History 的部分跨 Stack 恢復。
- 本輪補充 `.github/workflows/v58-cloud-backup-candidate-synthetic.yml`：未授權的 PR CI **只**跑安全契約測試和 synthetic mock-Drive 流程；`tests/v58-cloud-backup-candidate-policy.test.mjs` 證明不需任何 Production / Drive Secret，並驗證假憑證必被拒絕。**該 Workflow 不是已啟用的 Production 備份工作。**

## 3. 已實作正式雲端備份候選（仍在 Draft、未合併／未啟用）

在同一 Draft PR 中新增 `.github/workflows/v58-cloud-production-backup-candidate.yml`，僅允許 `workflow_dispatch`、main、人工確認、`v58-production-backup` Environment、精確核准 SHA 與非機密啟用變數。受保護 Secret 只在通過前置程式檢查後的工作步驟載入；沒有 Schedule、PR 驅動、Drive 刪除、正式 SQL 或部署。完整候選程式與 Codex 下一步見 [RAP16_CLOUD_PRODUCTION_CODEX_GATE_20261123.md](RAP16_CLOUD_PRODUCTION_CODEX_GATE_20261123.md)。**這是待審程式碼，不是已可執行且受控的 Production Job**；正式 Secrets 尚未設置或核實，不能自行執行。正式 Job **不得**直接由 PR、pull_request_target、workflow_run 或排程讀取 Production Secret；真正初次執行前仍須獨立安全審查，至少符合：

1. **Repo／Environment 邊界**：目前先沿用既有 public Repo + `main` + `v58-production-backup` 受保護 Environment；**GitHub Free 的 Private Repo 不可假定具備同等 Required Reviewer 保護**，不因為私有就擅自遷移。由 Codex GUI 重新核實 reviewer、branch restriction、bypass 與可用方案。預設不開 `schedule`；僅精確 `workflow_dispatch`、明確一次性授權後執行。PR 工作絕不可取得密鑰。
2. **執行碼鎖定**：工作樹來源只允許已核准的固定 SHA；第三方 Actions 固定檢查過的 SHA；`permissions: contents: read`、`persist-credentials: false`、無 PR 不受信程式碼、無 secrets 寫入檔案回傳或 Artifact。Job 自動發現未核准的 ref / host / project / role / folder 立即停止。
3. **最小憑證與單一快照**：僅使用只讀最低權限 DB 連線；先以安全方式核對 DB Host、project ref、TLS verify-full（適用時 CA）、PG17 client version、`PGPASSFILE` 0600；不允許 URI/password 在 argv、命令列追蹤、公開 Log。執行**一份** `pg_dump --format=custom` 一致性 snapshot；`pg_dumpall --globals-only --no-role-passwords` 的 global metadata 不屬於相同 MVCC snapshot，要另做一致性審查。若資料庫角色無法合法備份 Auth/Storage/Managed Schema，必須 fail closed，不能誤稱全量。
4. **加密先於傳輸**：Runner 暫存明文只能放 owner-only 短生命週期私密目錄，禁止 cache/Artifact/PR/console，並於加密驗證後立即刪除；runner 故障與系統層暫存風險仍須審查。使用經離線雙副本復原演練的**專用 age 公鑰 recipient**（SSH Ed25519 recipient 只作可選替代，不預設共用主 SSH 私鑰），Runner 不持有私鑰。
5. **Drive 只存密文**：使用受保護專用 OAuth、`drive.file` 最小 scope、只存 `.age` 和無 PII manifest；獨立下載已上傳的密文、驗 SHA-256／大小；未完成回讀或有任何資料外洩跡象則 NO-GO。初期不啟用刪除 API、輪替／排程前另審。
6. **完整還原不是只有 pg_restore**：在獨立、阻斷寄信/Webhook/付款的非正式 Supabase Stack，檢查 Auth identities/session 可重建、managed schema ownership/ACL、Storage 實際物件位元組、62 migrations、RLS/JWT、Finance RPC 指紋與金額守恆；各種非 SQL 平台設定仍須另外保護。既有 synthetic PASS **不代表**真人資料全量 Restore PASS。

## 4. 逐 Gate 驗收與授權

| Gate | 內容 | 本輪狀態 |
|---|---|---|
| S0 | PR #83 無憑證候選：PG17 → age → mock Drive → 獨立還原、假憑證／手動工作流程拒絕、密文 Drive mock 檢查 | 以最新 PR HEAD 的 Actions 為準，不能挪用前一 SHA 綠燈 |
| S1 | Main 已存在的受保護 synthetic-only 真實 Drive 傳輸測試（不碰 Production） | 有既有流程；本輪未重新觸發 |
| K0 | age 可恢復密鑰、分離雙份保存與實際試解密 | BLOCKED（需要 Owner 私密操作） |
| P0 | 正式 runner 最小權限、環境保護與秘密邊界的獨立審查 | NOT TESTED / NO-GO |
| P1 | 經授權的一次性 Production唯讀備份、age、Drive 上傳/取回 SHA | NOT TESTED / NO-GO |
| P2 | 真正隔離 Supabase Auth/Storage/帳務/RLS/History 恢復 | NOT TESTED / NO-GO |
| R | Migration 63 / 64，以及 Main+Production 發布 | 各自另需明確授權，不包含在備份授權內 |

**明確不再把 Codex Mac 缺少 PG17、Docker 或 FileVault CLI 證據作為 S0 的阻擋條件**，但 K0 / P0 / P1 / P2 未過，不得宣稱正式 G0 備份 Gate PASS；歷史 `RAP16_MAC_HOST_BOOTSTRAP_20261123.md` 改視為可選本機備援路線。

## 5. 參考（安全檢查以即時官方文件為準）

- GitHub Actions 安全使用：<https://docs.github.com/en/actions/reference/security/secure-use>
- GitHub Environments 保護：<https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- Supabase 備份：<https://supabase.com/docs/guides/platform/backups>
- Supabase 平台還原至自管服務：<https://supabase.com/docs/guides/self-hosting/restore-from-platform>
- age 說明：<https://github.com/FiloSottile/age>
