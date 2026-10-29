# 好好上課 V4｜零額外雲端費用的 Browser Staging 啟動手冊

狀態：**雲端一次性 CI 已執行；Mac 本機 Docker LAN 隔離仍是 BLOCKED**。建立日期：2026-10-29。
**目前不可照本文件直接啟動或重設既有容器。** Codex 先前實測 `tutor_v4_isolated` 的 API 54321／DB 54322 可從 Mac LAN IP 連入；既有 21 個合成 Auth 帳號與 36 筆本機 Migration 需要保留。必須先依 `docs/qa/V4_MAC_LOCALHOST_BIND_RECOVERY.md` 驗證 Docker 綁定、LAN 阻擋、Volume 身分和備份。
此文件隸屬 [Draft PR #43](https://github.com/zhichiangai/tutor-app/pull/43)，絕非正式發布許可。

## 為什麼不是第三個雲端 Supabase 專案

截至 2026-10-29，已連接的 Supabase `rapid4grad` Organization 使用 Free 方案，兩個活動專案為 `tutor-app` 及 `rapid4grad-v2`，兩個 RAPID 舊專案暫停。Supabase Free 方案僅有兩個活動專案額度。不能為了 V4 測試擅自升級、停用另一套正式服務、復用 RAPID 資料庫或建立有費用的專案。

選用現有可重播的 **本機 Supabase CLI + Docker**，在使用者的 Mac 測試、日後不需開啟即停止，費用僅為本機資源。真正 Google OAuth 與遠端跨裝置仍需獨立雲端 Staging 才能驗收，不能將本機 email/password 當作 Google OAuth PASS。

## 一、操作範圍（由 Codex 在已授權的本機 Mac）

1. 先檢查既有 worktree／本機容器，使用 **`chat/v4-release-integration-20261029`** 的已審查程式。不可覆寫未提交修改；不得因為要開新的 worktree，就重用既有 `tutor_v4_isolated` 的 project ID、Port 或 Volume 進行 `start/reset`。Mac 的安全復原手冊與現有資料保留優先於本文件。
2. 查驗 Docker Engine、Supabase CLI、Node、Python，以及目前本機 3000、54321–54324 ports 是否已有其他服務。若是其他用途，換隔離工作方式並回報阻擋，不停止使用者既有容器。
3. 先檢查 `supabase/config.toml` 的 `project_id = "tutor_v4_isolated"`，再用 `supabase start` 啟動本機服務。所有可能更動資料庫的指令只允許 `--local`、127.0.0.1:54321／54322；絕不使用 `--linked`、`db push`、`migration repair`、部署或雲端連結。
4. **既有 Mac `tutor_v4_isolated` 內已有 21 個合成 Auth 帳號；不允許 `db reset`。** `supabase db reset --local --no-seed` 僅可用於 GitHub Actions 的一次性 Runner，或明確確認新建且無資料、Port 與 Volume 完全獨立的容器；任何不確定情況一律停止。
5. 在此本機資料庫依序審查並套用：
   - `supabase/hotfixes/20261028_parent_payment_active_link_select.sql`
   - `supabase/candidates/20261028_v4_payment_batch_qa_classification.sql`
   - `supabase/candidates/20261029_v4_qa_lesson_and_legacy_receipt.sql`
   - `supabase/candidates/20261029_v4_accounting_qa_snapshot_rpc.sql`
   - `supabase/candidates/20261029_v4_qa_real_payment_rpc_reconciliation.sql`
   - `supabase/candidates/20261029_v4_qa_reclassification_guard.sql`
   **以上是供全新一次性 CI 環境使用的候選順序，並非授權直接重播到 Mac 已有資料的容器。** 既有 Mac DB 先完成 LAN 阻擋／備份、審查 Migration 36→37 的向前套用，再判定候選 SQL 是否已套用與是否可重複執行；不可重複建表、覆寫 RPC 或盲目執行。以上 SQL 從不直接套用 Production。
6. 建立至少三個**新建合成** Auth 使用者：teacher / parent / student。建議沿用 `tests/local/v40-*.mjs` 與 `tests/local/v4-qa-classification-rest.mjs` 中對 Auth／RLS 的合成測試方法；不能使用正式 Google 帳號、真實 Email 或匯入真實學生資料。Email 採 `@local.invalid`，密碼只留本地測試檔，不要貼到對話、PR 或 log。
7. 用開發機本地的瀏覽器存取 `http://127.0.0.1:3000/v2/index.html`。本機版 `v2/v4-config.js` 要求在它執行**之前**有 `window.V4_LOCAL_BACKEND`，且只接受：
   - `environment: "local"`
   - `isolated: true`
   - `projectRef: "local"`
   - `url: "http://127.0.0.1:54321"`
   - `publishableKey`：**僅本機 Supabase `supabase status -o json` 的 public ANON_KEY**，不可使用 Service Role、Secret Key 或正式專案 Key。
   可以在**拷貝出來的臨時網站目錄**加入本機專用 config script（置於 `v4-config.js` 前）；**不得提交包含任何 key 的檔案，也不可修改正式部署 config**。
**特別注意：正式 V4 登入頁目前只有 Google OAuth 按鈕，沒有 email/password 表單。** 因此即使建立合成 Auth 使用者，仍須在**臨時網站副本**提供只在 localhost 出現的合成登入方式，或用瀏覽器 DevTools 在相同 origin 建立相同 Supabase 客戶端後執行 `signInWithPassword`；一切僅限 `127.0.0.1`，不可把 email/password 登入介面部署到 Preview／Production。登入後須確認原本 app `getSession()` 能接到同一個 JWT／Auth storage key。若不能，請回報 BLOCKED，不可偷用正式 Google OAuth。

8. 本機用例如 `python3 -m http.server 3000 --bind 127.0.0.1` 從 repo 根目錄提供靜態頁面；應確認網頁／API 的 request 只能到 localhost 及固定的既有靜態 CDN（若有）。若 Codex 的內建瀏覽器不能連 localhost，明確標記 BLOCKED，不得改用正式 Supabase。
9. 用瀏覽器和各自獨立 profile／context 驗證老師、家長、學生：首次登入／登出清空、共享課表新增修改取消、老師／家長付款回報確認更正、QA 部分付款與舊式收款隔離、解除連結後**沿用舊 JWT 及舊付款 ID 仍不可讀**、學生不顯示金額。滑鼠點擊、選單、彈窗、320／375／390／430px 手機版捲動與防溢出由 Codex 留存畫面證據，不能以 CI Chromium PASS 代替 Mac 實機結論。不論測試是否通過，所有資料都留在 local。
10. 不運行 GAS 寄信與外部 Trigger；不更動正式網站、Production Migration 或 main。完成後給出 PASS／FAIL／BLOCKED 及可重現步驟、截圖／Console、SQL 版本 SHA、瀏覽器來源，不洩漏密鑰；**未獲授權不要清理、刪除或重設任何非本次新建資源**。

## 二、已存在且通過的自動化證據（不是 Mac 實機驗收）

- PR #43： https://github.com/zhichiangai/tutor-app/pull/43
- CI 完成：V3 Node 229/229；PostgreSQL Contract；QA 模擬角色 Postgres；V4 本機 GoTrue JWT；QA 本機真實 GoTrue JWT 5 個身分／71 項斷言。
- CI 只在 GitHub Actions 的 disposable 環境驗證，**不會自動提供 Codex 可登入的雲端測試網站**。
- PR #43 Vercel Preview 可唯讀導覽；因未綁雲端隔離資料庫，不可在該網址測試三角色登入。

## 三、釋出門檻

全部帳務／RLS／三角色瀏覽器實測完成前，保持 V4 **NO-GO**。本機測試通過只解決本機驗收；正式發布仍需正式 schema diff、備份、實際還原與使用者批准。若未來需要跨裝置測試，應先由使用者選定 Supabase Organization 與同意報價，再建立新的獨立雲端測試專案；絕不能透過借用其他正式專案繞過額度。
