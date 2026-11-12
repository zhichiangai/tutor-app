# V5 方案 A｜GitHub Actions 正式發布操作手冊（2026-11-11）

> **狀態：基礎設施 Draft PR #70；尚未在 Main 啟用，也未執行任何正式 Migration。**
> 此文件描述對正式庫安全放行的必要條件。不要因為原資料多為測試資料，就略過 RLS、版本追蹤或部署目標核對。

## 1. 兩個 PR 的職責

- [PR #69](https://github.com/zhichiangai/tutor-app/pull/69)：`release/v5-20261111`，V5 應用程式、19 份不可變 SQL、封裝器與 `docs/v5/V5_PRODUCTION_RELEASE_APPROVAL.json`（目前 `BLOCKED`）。**在正式資料庫升級完成前不得合併到 Main。**
- [PR #70](https://github.com/zhichiangai/tutor-app/pull/70)：`ops/v5-production-actions-20261111`，只有正式 Migration GitHub Actions 流程／讀取檢查／回歸測試，無 V5 前端功能。要使用 `workflow_dispatch` 必須先讓此工作流程檔存在於預設分支 `main`。**Main 會連動 Vercel Production，合併 PR #70 也可能觸發同一版 V4 的重新部署，因此需先確認 Vercel 專案及現有 Production SHA。**

## 2. 使用者需要在 GitHub Dashboard 設定一次（不要貼任何憑證到聊天、PR、Issue）

進入 GitHub `zhichiangai/tutor-app` → **Settings → Environments** → 新建或確認 `v5-production-db`：

1. 將 **Deployment branches and tags** 限制為 `main`。
2. 設定 **Required reviewers**，至少有一個能核准的帳號；如果只有自己一人可審核，不能同時啟用「Prevent self-review」而讓環境永遠無人能審。
3. 在 Environment **Secret** 新增 `V5_PRODUCTION_DB_URL`。只能從 Supabase `vctisuglfoxyuwlvyjee` 的 **Connect → Session pooler** 安全取得，使用 PostgreSQL 5432、資料庫 `postgres`、正確專案使用者、`sslmode=require`（或更嚴格 TLS）。不得使用 transaction pooler 6543。密碼只存放 GitHub secret。
4. 在 Environment **Variable** 建立 `V5_APPROVED_RELEASE_SHA`，值是經審核的 PR #69 **最新完整 40 字元 SHA**。每次 Release Branch 更新都要重設為新 SHA。
5. Environment **Variable** `V5_WRITE_ENABLED` 預設維持 `NO`。真正解除發布 Gate 前不可改成 `GO`。

GitHub repository 為 public，公開 Repository 的 GitHub Environment 與 Required reviewers 可用；但 GitHub 連接工具不能替使用者新增 Environment Secret 或代為核准。所有檢查只透過 workflow 以 Environment Secret 調用，程式碼不含秘密值。

## 3. 首次只跑 Dry Run

確認 PR #70 與 PR #69 的隔離 CI 都是全 PASS，並核實 Vercel Main 自動部署的專案與正式網域，再將 **只有操作管線程式碼** 的 PR #70 併入 Main。

前往 **Actions → V5 protected Production database migration → Run workflow**，選擇 `main`：

- `release_sha`：PR #69 已審核的 40 字元 SHA。
- `operation`：`preflight`。
- `confirmation`：留白。

環境審核核准後，工作流程會依序：檢查來源 SHA、封裝 43＋19 SQL、確認 Supabase 專案、**唯讀**檢查正式 43 筆歷史 SQL MD5、V4 RLS、V5 尚未啟用、執行 `supabase db push --db-url ... --dry-run`，且不帶 `--include-all`、不帶 `--include-seed`。失敗就結束，不進行資料庫寫入。

> 注意：GH Actions 的 PASS 只代表執行到的特定 `preflight` 範圍通過，不等於正式 Migration 已完成。

## 4. 由 ChatGPT 整合安全證據，再核准 Apply

更新 PR #69 的 `docs/v5/V5_PRODUCTION_RELEASE_APPROVAL.json`：只有全部要求的帳務、RLS、外部副作用、Vercel 正式專案與失敗停損審查及 **正式 CLI Dry Run** 都有可追溯 PASS 證據，才可將 `status` 改為 `GO`、記載實際使用者授權與審查理由。舊 Source-Lock `approved_release:NO_GO` 屬原本測試版來源鎖，不應偷偷變更來跳過 CI。

Release Branch 這時會產生**新的 SHA**，必須重新跑完整 CI，更新 GitHub Environment 的 `V5_APPROVED_RELEASE_SHA`，再以新 SHA 重跑 `preflight`。確認一致後將 `V5_WRITE_ENABLED` 改為 `GO`。

## 5. 正式 Apply

在 Actions 再次手動 Run：

- `release_sha`：批准的最新 SHA。
- `operation`：`apply`。
- `confirmation`：`APPLY_V5_19_<SHA>`，其中 SHA 必須與本次完整 40 字元 SHA 完全一致。

環境審核後，Workflow 仍先進行 43/43 檢查與 Dry Run，再驗證發布文件 GO、approved SHA、環境寫入開關及確認字串；通過後才執行**精確的 19 份 V5 forward SQL**。完成後獨立檢查 62 筆 Migration、原 43 筆 checksum、V4 核心 RLS、V5 RLS 與匿名權限。

如果 Migration 失敗或只套用部分，立即 **STOP / NO-GO**；不可盲目重跑、`db reset`、`migration repair`、刪除學生／帳務紀錄或先合併 Main。按實際已套用版本研擬向前修復。

## 6. Main 與最後 GUI 驗收

**只有正式 DB 已達 62 筆版本、權限與 RLS postflight PASS、Vercel 專案與正式部署渠道已核實，才把 PR #69 合併 Main。**

使用 Codex 內建瀏覽器核對正式 `https://tutor.rapid4grad.com/v2/index.html` 的 READY SHA，登入老師／家長／學生，驗收個人課表、帳務與學習、Team 專案、老師權限、退款與 RWD；手機 320／375／390／430 px。Production 測試預設唯讀，不自行新增帳務或觸發外部付款。

## 7. 目前阻擋（不可冒充 PASS）

- PR #70 尚未合併 Main，`workflow_dispatch` 仍不可在預設分支使用。
- 尚未由工具查證 Environment `v5-production-db` 的保護／Secret／變數設定。
- 無證據顯示 `tutor-app-v2` 已對目前 Vercel 連接權限開放；先前 Codex GUI 曾確認 Preview READY，但 Production 對應版本尚待查。
- PR #69 的 `V5_PRODUCTION_RELEASE_APPROVAL.json` **BLOCKED**，正式 Dry Run 尚未執行。
- 正式 Supabase 目前 43 筆 V4 Migration，19 筆 V5 尚未套用。
