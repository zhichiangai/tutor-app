# RAP-12｜可拋棄本機 Team 雙帳號 GUI 驗收操作手冊

> **僅適用隔離 localhost；非正式站。** 不授權 Main/Production 部署、Migration 63、正式資料庫寫入或對外寄信。

## 目的與新增檔案

既有 CI 已有本機 GoTrue、PostgREST、Playwright 以及 Team RLS/GUI 測試，但 CI 環境結束後不會在 Mac 持續提供可供 IAB 使用的網站。

這個 Draft PR 新增：

- tests/e2e/seed-rap12-team-local.mjs：在本機建立三個真正獨立的合成 Auth 身分、兩個 Team、三個 Project、三筆學生、三堂完成課程及管理者確認費用，並實際使用不同 JWT 核對跨 Team、私人課程及帳務 RLS。
- tests/e2e/rap12-local-host.mjs：只監聽 127.0.0.1:3000，提供本機原網站以及 /__rap12/ 合成身分選擇頁。可用 GUI 選擇 Team A 管理者、Team A 一般老師或 Team B 管理者，不需 Google OAuth，測試憑證不出現在畫面或網址。
- tests/e2e/rap12-team-gui.spec.mjs、rap12.config.mjs：390 與 1440px 使用真正獨立本機帳號的 Chromium GUI 驗證。

## Mac 的安全 Gate

1. Codex 先讀根目錄 AGENTS.md 與 note/ai-handover 文件，保全未提交的本機修改。從 GitHub 取得 RAP-12 Draft PR 分支，不要直接覆寫本機工作樹。
2. 確認 supabase/config.toml 的 project_id 是 tutor_v4_isolated，且不存在 supabase/.temp/project-ref。**不可使用 supabase link、db push 或任何 hosted SQL**。
3. 確認 Docker Desktop 的新建容器 port binding 為 Localhost only；已建立容器也不得把此專案的測試連接埠綁到 0.0.0.0 或 ::。若需修改 Docker 全域設定或重建其他專案容器，先停下並請使用者核准。
4. 確認 docker、supabase CLI、Node、npm、Python3 可用。依 supabase --help、supabase start --help、supabase db reset --help 核對 CLI 語法。
5. 只在 localhost 隔離資料庫可拋棄且沒有重要既有資料時，才可以 reset 這個本機專案。不可以刪除任何 Hosted Supabase 資料。

## 一次性啟動範例

在已確認安全的本機專案根目錄，逐行執行以下命令。這是操作說明，ChatGPT 尚未在 Mac 執行。

    git status --short
    grep -F 'project_id = "tutor_v4_isolated"' supabase/config.toml
    test ! -f supabase/.temp/project-ref
    supabase --version
    supabase start --help
    supabase db reset --help

    # 只有 Docker 的 Localhost only Gate 與可拋棄 DB Gate 都通過才往下
    supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
    supabase db reset --local --no-seed

    export V4_E2E_LOCAL=1
    export RAP12_TEAM_GUI_LOCAL=1
    export RAP12_FIXTURE_FILE="$TMPDIR/rap12-team-gui-$(date +%s).json"

    npm install --no-save --no-package-lock @playwright/test@1.64.1 @supabase/supabase-js@2.76.1
    npx playwright install chromium

    # 以下會驗證 127.0.0.1:54321/54322、unlinked project、
    # 以及 Mac Docker 全部本地測試容器的 Host IP；不符合即失敗停止
    node tests/e2e/seed-rap12-team-local.mjs

    # 方法 A：獨立 Chromium 合成 GUI（自動啟動並關閉測試網站）
    npx playwright test --config tests/e2e/rap12.config.mjs

    # 方法 B：Codex IAB 真實 GUI（保持此命令持續執行）
    node tests/e2e/rap12-local-host.mjs

Codex IAB 打開：http://127.0.0.1:3000/__rap12/

只測 390×844 與 1440×844。依序選擇三種身分並查看相同網站；不同身分必須具有不同 GoTrue User ID。若 IAB 無法連本機 loopback，明確報 BLOCKED，不可改用 Production 網域假裝已測本機權限。

合成帳號密碼只會存放在本機 OS 暫存目錄中的 RAP12_FIXTURE_FILE，權限 0600；不能貼入聊天、公開 PR、截圖或日誌。localhost QA 角色選擇頁不輸出密碼或 Token。

## 預期權限矩陣

| 資源 | Team A 管理者 | Team A 一般老師 | Team B 管理者 |
|---|---|---|---|
| Team A Shared Project | 可見 | 可見 | 不可見 |
| Team A Manager Only Project | 可見 | 不可見 | 不可見 |
| Team B Foreign Project | 不可見 | 不可見 | 可見 |
| Team A Shared 學生及課程 | 可見 | 可見 | 不可見 |
| Team A Manager Only 學生及課程 | 可見 | 不可見 | 不可見 |
| Team A 私人費率與確認入口 | 可見 | 不可見 | 不可見 |

必須對照已確認的產品權限規格。按鈕隱藏不能代替 RLS；後端 RLS 測試另有真實不同本機 JWT 證據。Production 跨帳號驗收仍屬 NOT TESTED。

## 結束

1. 逐一登出合成帳號，停止 rap12-local-host.mjs，恢復 viewport。
2. 只刪自己產生的憑證檔：rm -f "$RAP12_FIXTURE_FILE"。
3. 若要停掉 Supabase，只對確定的 tutor_v4_isolated 可拋棄專案使用 CLI；不得全域 stop/prune 其他 Docker 專案。
4. 報告各角色與尺寸、登入安全、權限差異、RLS/GUI 各自證據、是否修改正式資料。不得把本機測試當成正式 Production PASS。
