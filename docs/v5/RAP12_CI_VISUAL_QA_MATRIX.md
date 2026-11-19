# RAP-12｜方案 A：雲端 CI + Codex 合成畫面驗收矩陣

> **適用範圍**：GitHub Draft PR #94 的 disposable-local GoTrue/JWT/Postgres + Chromium 測試，不使用正式 Supabase，也不要求 Mac Docker。這是 **CI 合成環境**，不取代 Production 雙帳號 GUI／RLS 驗收。

## 驗收責任

- **ChatGPT**：維護 Draft PR 測試與 CI、檢查最新 Head SHA、紀錄 Linear RAP-12，正式 Main／Migration 另需授權。
- **GitHub Actions**：以真實不同合成 GoTrue User ID 登入三個角色、驗證正向／負向權限，產生 PNG 證據。
- **Codex Desktop**：下載 GitHub Actions 最新成功 Run 的 `rap12-isolated-team-gui` Artifact，閱讀合成圖片，不啟動 Mac Docker；把人工視覺結果與自動化驗證結果分開。

## 當前場景矩陣

| 代碼 | 身分 | 頁面 | 預期呈現 |
|---|---|---|---|
| managerA-projects | Team A 管理者 | Projects | Alpha Shared、Alpha Manager Only；無 Beta Foreign；有管理控制 |
| managerA-learning | Team A 管理者 | Learning | Shared Math；無 Beta Foreign 課程；有管理功能 |
| managerA-billing | Team A 管理者 | Billing | 只能看到本 Team 帳務；補充說明可捲動完整閱讀 |
| teacherA-projects | Team A 一般老師 | Projects | Alpha Shared；沒有 Manager Only／Beta Foreign；沒有管理專用控制 |
| teacherA-learning | Team A 一般老師 | Learning | Shared Math；沒有 Private Science／Foreign English；沒有管理控制 |
| managerB-projects | Team B 管理者 | Projects | 只有 Beta Foreign，不可見 Alpha Shared 或 Alpha Manager Only |
| managerB-learning | Team B 管理者 | Learning | Foreign English；不可見 Shared Math／Private Science；不能切到 Team A |

**寬度**：320、375、390、430、1440 px（高度均 844 px）。每個寬度執行完整七個場景的三身分獨立 BrowserContext 測試。

**基準高細節圖片**：390 與 1440 各七場景，分別儲存 `-page.png` 全頁與 `-card.png` 卡片特寫，共 28 張。

**手機真實 viewport**：320／375／390／430 各七場景，捲動到該卡片最後一個可見控制項，儲存 `-viewport-bottom.png`，共 28 張；同時記錄固定導覽幾何、控制項 hit-test、水平溢出。

**Billing 說明文字**：320／375／390／430 各一張 `managerA-billing-<寬度>-viewport-copy-end.png`，捲至文件底部，核對最後一段退款說明文字**整段**位於固定導覽上方，記錄 `RAP12_BILLING_COPY_CLEARANCE`，共 4 張。

**預期 Artifact 數量**：28 + 28 + 4 = **60 張 PNG**，且**只能包含 PNG**。工作流程在上傳前檢查檔案數量、PNG header、viewport 寬高及禁止 `trace.zip`；不保留原始 Auth token、HTML、Trace 或包含敏感 Header 的網路紀錄。PNG 仍應視為受控合成測試證據，不公開真實帳密。

## Codex 人工驗收順序

1. 核對 PR #94 最新 Head SHA 與最新 CI Run 的 Commit **完全相同**，檢查 Node、既有 Chromium 62/62、RAP-12 五種寬度測試與 screenshots audit 是否成功；不可用舊 SHA 的 PASS 替代新版本。
2. 優先看四張 Billing 說明文字的 `-viewport-copy-end.png`，檢查說明文字末行在底部導覽上方完整可讀；若文字仍遮蓋，列出檔名／遮蓋位置。
3. 檢查 320／375／430 共 21 張新的 mobile viewport 圖，尤其 Team 專案、Learning 月曆與 Billing 表單的最後控制項、回應式換行、固定底部導覽是否重疊。
4. 上一輪已完成的 390 圖（6 PASS、1 Billing PARTIAL）及 1440 圖（7 PASS）不需無故重測；但若最新 HEAD 的視覺結果改變，必須重新記錄。
5. 將「Playwright/JWT/RLS **自動化 PASS**」、「合成 PNG **人工視覺 PASS/PARTIAL/FAIL**」、「Codex IAB 即時點擊 **NOT TESTED**」、「Production 雙帳號 GUI/RLS **NOT TESTED**」分欄。
6. 若有 FAIL，必須提供圖檔、角色、viewport、預期／實際結果與可重現步驟；不得猜測不存在的操作缺陷，也不得將合成測試當作正式資料庫授權證明。

## 安全、成本與發布 Gate

- GitHub Actions 暫時啟動可拋棄的 localhost Supabase，只對隔離合成資料作業，`productionWrites=0`。
- Trace 保持 OFF；Playwright 原始 Trace 可能包含 session/headers/token。想擴增 Trace，先通過獨立清洗、權限與附件審查。
- 不要求 Codex 修 Mac Docker Desktop 或 CLI；不要求登入正式帳號。測試附件可能過期，Codex 應以最新相符 SHA 的 Action Artifact 為準。
- PR #94 保持 Draft；Production Main/Vercel/Supabase/Migration 63 的發布、改權限、資料改寫**均須另外授權**。
- 即使 CI 與合成畫面均 PASS，Linear RAP-12 正式 GUI 驗收仍維持 In Progress，直到實際 Production 對應關卡完成。
