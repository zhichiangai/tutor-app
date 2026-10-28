# 好好上課 V4｜零額外雲端費用的 Browser Staging 啟動手冊

狀態：**準備文件，尚未在使用者 Mac 執行**。建立日期：2026-10-29。
此文件隸屬 [Draft PR #43](https://github.com/zhichiangai/tutor-app/pull/43)，絕非正式發布許可。

## 為什麼不是第三個雲端 Supabase 專案

截至 2026-10-29，已連接的 Supabase `rapid4grad` Organization 使用 Free 方案，兩個活動專案為 `tutor-app` 及 `rapid4grad-v2`，兩個 RAPID 舊專案暫停。Supabase Free 方案僅有兩個活動專案額度。不能為了 V4 測試擅自升級、停用另一套正式服務、復用 RAPID 資料庫或建立有費用的專案。

選用現有可重播的 **本機 Supabase CLI + Docker**，在使用者的 Mac 測試、日後不需開啟即停止，費用僅為本機資源。真正 Google OAuth 與遠端跨裝置仍需獨立雲端 Staging 才能驗收，不能將本機 email/password 當作 Google OAuth PASS。

## 一、操作範圍（由 Codex 在已授權的本機 Mac）

1. 建立一個全新的本地 clone 或隔離 git worktree，checkout **`chat/v4-release-integration-20261029`**，不得在正式正在開發的 `main` 工作目錄更動未提交檔案。先 `git status --short`；如有原有修改則不覆寫。
2. 查驗 Docker Engine、Supabase CLI、Node、Python，以及目前本機 3000、54321–54324 ports 是否已有其他服務。若是其他用途，換隔離工作方式並回報阻擋，不停止使用者既有容器。
3. 先檢查 `supabase/config.toml` 的 `project_id = "tutor_v4_isolated"`，再用 `supabase start` 啟動本機服務。所有可能更動資料庫的指令只允許 `--local`、127.0.0.1:54321／54322；絕不使用 `--linked`、`db push`、`migration repair`、部署或雲端連結。
4. 只在**全新、確認沒有既有使用者資料**的 isolated local 容器內執行 `supabase db reset --local --no-seed`；如果容器已有紀錄，停止詢問，不重設、不刪除。
5. 在此本機資料庫依序審查並套用：
   - `supabase/hotfixes/20261028_parent_payment_active_link_select.sql`
   - `supabase/candidates/20261028_v4_payment_batch_qa_classification.sql`
   - `supabase/candidates/20261029_v4_qa_lesson_and_legacy_receipt.sql`
   - `supabase/candidates/20261029_v4_accounting_qa_snapshot_rpc.sql`
   SQL 只能對連接到 localhost 的 docker `supabase_db_tutor_v4_isolated` 容器套用，且執行前先審閱內容／相依性；任何錯誤立刻停止。
6. 建立至少三個**新建合成** Auth 使用者：teacher / parent / student。建議沿用 `tests/local/v40-*.mjs` 與 `tests/local/v4-qa-classification-rest.mjs` 中對 Auth／RLS 的合成測試方法；不能使用正式 Google 帳號、真實 Email 或匯入真實學生資料。Email 採 `@local.invalid`，密碼只留本地測試檔，不要貼到對話、PR 或 log。
7. 用開發機本地的瀏覽器存取 `http://127.0.0.1:3000/v2/index.html`。本機版 `v2/v4-config.js` 要求在它執行**之前**有 `window.V4_LOCAL_BACKEND`，且只接受：
   - `environment: "local"`
   - `isolated: true`
   - `projectRef: "local"`
   - `url: "http://127.0.0.1:54321"`
   - `publishableKey`：**僅本機 Supabase `supabase status -o json` 的 public ANON_KEY**，不可使用 Service Role、Secret Key 或正式專案 Key。
   可以在**拷貝出來的臨時網站目錄**加入本機專用 config script（置於 `v4-config.js` 前）；**不得提交包含任何 key 的檔案，也不可修改正式部署 config**。
8. 本機用例如 `python3 -m http.server 3000 --bind 127.0.0.1` 從 repo 根目錄提供靜態頁面；應確認網頁／API 的 request 只能到 localhost 及固定的既有靜態 CDN（若有）。若 Codex 的內建瀏覽器不能連 localhost，明確標記 BLOCKED，不得改用正式 Supabase。
9. 用瀏覽器和各自獨立 profile／context 驗證老師、家長、學生：首次登入／登出清空、共享課表新增修改取消、老師／家長付款回報確認更正、QA 部分付款與舊式收款隔離、解除連結後家長不再可讀、學生不顯示金額。不論測試是否通過，所有資料都留在 local。
10. 不運行 GAS 寄信與外部 Trigger；不更動正式網站、Production Migration 或 main。完成後給出 PASS／FAIL／BLOCKED 及可重現步驟、截圖／Console、SQL 版本 SHA、瀏覽器來源，不洩漏密鑰；**未獲授權不要清理、刪除或重設任何非本次新建資源**。

## 二、已存在且通過的自動化證據（不是 Mac 實機驗收）

- PR #43： https://github.com/zhichiangai/tutor-app/pull/43
- CI 完成：V3 Node 229/229；PostgreSQL Contract；QA 模擬角色 Postgres；V4 本機 GoTrue JWT；QA 本機真實 GoTrue JWT 5 個身分／71 項斷言。
- CI 只在 GitHub Actions 的 disposable 環境驗證，**不會自動提供 Codex 可登入的雲端測試網站**。
- PR #43 Vercel Preview 可唯讀導覽；因未綁雲端隔離資料庫，不可在該網址測試三角色登入。

## 三、釋出門檻

全部帳務／RLS／三角色瀏覽器實測完成前，保持 V4 **NO-GO**。本機測試通過只解決本機驗收；正式發布仍需正式 schema diff、備份、實際還原與使用者批准。若未來需要跨裝置測試，應先由使用者選定 Supabase Organization 與同意報價，再建立新的獨立雲端測試專案；絕不能透過借用其他正式專案繞過額度。
