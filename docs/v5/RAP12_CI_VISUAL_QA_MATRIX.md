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

**完整頁面與關鍵卡片圖片**：320／375／390／430／1440 各七場景，分別儲存 `-page.png` 全頁與 `-card.png` 卡片特寫，共 **70 張**。保留原本 390／1440 的 28 張組合，新增 320／375／430 的 **42 張**；這次應優先人工複核新增 42 張。

**手機真實 viewport**：320／375／390／430 各七場景，捲動到該卡片最後一個可見控制項，儲存 `-viewport-bottom.png`，共 28 張；同時記錄固定導覽幾何、控制項 hit-test、水平溢出。

**Billing 說明文字**：320／375／390／430 各一張 `managerA-billing-<寬度>-viewport-copy-end.png`，捲至文件底部，核對最後一段退款說明文字**整段**位於固定導覽上方，記錄 `RAP12_BILLING_COPY_CLEARANCE`，共 4 張。

**預期 Artifact 數量**：70 + 28 + 4 = **102 張 PNG**（比原本 60 張增加 42 張），且**只能上傳 PNG**。工作流程在上傳前檢查精確七場景 × 五尺寸 × 圖片種類的檔名集合、PNG header、完整頁面寬高、viewport 寬高、沒有多餘檔案與禁止 `trace.zip`；只允許 Playwright 私有 `.last-run.json` 暫存在 CI runner，透過 PNG-only glob 排除，不上傳原始 Auth token、HTML、Trace 或包含敏感 Header 的網路紀錄。PNG 仍應視為受控合成測試證據，不公開真實帳密。

## Codex 人工驗收順序

1. 核對 PR #94 最新 Head SHA 與最新 CI Run 的 Commit **完全相同**，檢查 Node、既有 Chromium 62/62、RAP-12 五種寬度測試與 screenshots audit 是否成功；不可用舊 SHA 的 PASS 替代新版本。
2. **本輪人工優先範圍是新增 42 張**：`{managerA,teacherA,managerB}-{projects,learning,billing}-{320,375,430}-{page,card}.png` 中僅七個合法場景（無一般老師 Billing）。逐尺寸核對完整頁面、對應卡片內的文字換行、表單、月曆、按鈕、內容與管理權差異，列出場景 × 尺寸的 PASS/PARTIAL/FAIL。
3. 將新增 `-page`／`-card` 與原已驗收的 21 張 `-viewport-bottom` 圖交叉核對：fullPage 固定底部導覽可能出現在中段，應以真正 viewport 捲動位置和 hit-test 判定可觸及性，不將截圖疊影自行當成產品 FAIL。
4. 四張 Billing `-viewport-copy-end.png` 已有人工作業 4/4 PASS，390px 七場景和 1440px 七場景此前也 7/7 PASS；除非最新 Commit 修改了產品 UI 或出現新證據，不重新人工複核這些舊圖。
5. 將「Playwright/JWT/RLS **自動化 PASS**」、「合成 PNG **人工視覺 PASS/PARTIAL/FAIL**」、「Codex IAB 即時點擊 **NOT TESTED**」、「Production 雙帳號 GUI/RLS **NOT TESTED**」分欄。
6. 若有 FAIL，必須提供圖檔、角色、viewport、預期／實際結果與可重現步驟；不得猜測不存在的操作缺陷，也不得將合成測試當作正式資料庫授權證明。

## 安全、成本與發布 Gate

- GitHub Actions 暫時啟動可拋棄的 localhost Supabase，只對隔離合成資料作業，`productionWrites=0`。
- Trace 保持 OFF；Playwright 原始 Trace 可能包含 session/headers/token。想擴增 Trace，先通過獨立清洗、權限與附件審查。
- 不要求 Codex 修 Mac Docker Desktop 或 CLI；不要求登入正式帳號。測試附件可能過期，Codex 應以最新相符 SHA 的 Action Artifact 為準。
- PR #94 保持 Draft；Production Main/Vercel/Supabase/Migration 63 的發布、改權限、資料改寫**均須另外授權**。
- 即使 CI 與合成畫面均 PASS，Linear RAP-12 正式 GUI 驗收仍維持 In Progress，直到實際 Production 對應關卡完成。

## PR Review Ready 與正式站安全門檻（2026-11-19 補充）

- **只評估，不自動切換 GitHub Draft 狀態或合併。** 同一最新 HEAD 必須 Node／既有 Chromium／五尺寸 RAP-12／Billing／固定導覽幾何、102 PNG 安全稽核全部 PASS，且新增 42 張已由 Codex 人工逐張審查並回報具名檔案和結論，才能建議「測試 PR 可供 Review」。未過時維持 Draft。
- PR #94 僅增補隔離測試、CI 與文件，**不需要 Migration 63 才能審查本身的測試程式**。候選 Migration 63 是家長逐 Project 應收 RPC 的獨立發布 Gate，不得偷渡到 RAP-12；此 PR 的通過不授權正式 SQL、RLS 修改或 Main 合併。
- **Production Team 實際 GUI 尚欠獨立的合法角色身分**：Team A 管理者、Team A 一般老師、Team B 管理者三種不同 Google／Supabase User ID，各自確實具有效成員關係。必須在合法授權工作階段做唯讀觀察：管理者專案／課表／帳務、一般老師受指派項目及禁止管理區、跨 Team 不可見項目。不可用同一登入切換頁面或合成截圖假冒三個 JWT；不可建立虛構課程／付款或曝光真實學生資料。
- **正式 RLS 不能只看「已啟用」**：另需具體授權範圍與對應資料隔離測試、PR/RPC 權限檢視。若 Production 不具安全、可授權的三身分與匿名化證據，標記 NOT TESTED/BLOCKED，保留 RAP-12 In Progress。
- 本次工作不清除任何 Google Drive／Actions Artifact、正式資料、Mac 本機 Docker volume 或測試帳號；所有獨立 Production 合併、部署、Migration 或 Auth/RLS 變更需新授權及備份/回復確認。
