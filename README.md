# 好好上課（tutor-app）｜家教課程與收付款管理 V3.4.1

**正式網站：** https://tutor.rapid4grad.com/  
**程式碼：** https://github.com/zhichiangai/tutor-app  
**目前版本：** V3.4.1（2026-10-21），部署基準為 GitHub `main`。 

> 本 README 說明**目前正式運行的 Vercel + Supabase 版**。舊 GAS、Google Sheets 和 GitHub Pages 專案仍保存在程式庫內，但**不是本網域 V3.3 使用的後端**。舊版記錄見 [歷史 README](docs/legacy-readme-20261019.md)。

## 正式系統架構

```text
老師／家長／學生（電腦或手機瀏覽器）
     ↓
https://tutor.rapid4grad.com
     ↓
Vercel：從 main 發布，依 vercel.json 路由至 v2/ 靜態前端
     ├── Supabase Auth：Google OAuth 登入
     └── Supabase PostgreSQL：學生、課程、固定課表、邀請、帳務與稽核紀錄
                    ├── RLS：老師工作空間、家長連結等權限
                    └── 受控 RPC：三方共同排課與學生專用資料
```

- **前端**：`v2/index.html`、`v2/app.js`、`v2/style.css`，原生 HTML／JavaScript，依 `vercel.json` 設定正式網址的檔案路由。
- **資料庫專案**：Supabase `tutor-app`（Project Ref：`vctisuglfoxyuwlvyjee`，東京區域）；歷次 SQL 版本存放於 `supabase/migrations/`。
- **正式部署**：Vercel `tutor-app-v2`（請以 Vercel Deployments 查詢目前生效版本）；GitHub PR 合併不表示 SQL migration 自動套用。
- **舊版**：`frontend/`、`backend/apps-script/` 供歷史與舊資料參考。不要以這兩個路徑推斷 V3.3 正式站的行為。

## V3.4.1 排課體驗修正

- **單堂補課與固定週期不同**：雙週 12/16 的課可以補到 12/23，不會把整組課表改成每週，12/30 仍照原規則上課。資料庫驗證原定日期是否屬於固定週期、補課目標時段是否撞期。
- **錯誤提示保留**：三方共同排課遭拒絕（時間衝突或版本過期）時，表單顯示明確、可持續閱讀的錯誤說明；不依賴短暫 Toast。
- `v2/README.md` 已更新為正式 Vercel + Supabase 架構；原 V2 歷史部署文件歸檔在 `docs/legacy-v2-readme-20261020.md`。

## 使用者角色與功能

| 功能 | 老師 | 已連結家長 | 已連結學生 |
| --- | --- | --- | --- |
| 查看屬於自己的課程 | ✅ | ✅ | ✅ |
| 新增單堂、每週／雙週固定課表 | ✅ | ✅ | ✅ |
| 改期、調整與取消課程 | ✅ | ✅ | ✅ |
| 課後回饋／評分 | 編輯 | 查看 | 查看 |
| 設定鐘點費與確認收款 | ✅ | — | — |
| 付款申報與對帳 | 查看／確認 | 申報／查看 | 不顯示 |
| 修改其他沒有連結的學生資料 | 禁止 | 禁止 | 禁止 |

三方管理的是**同一份課表**，但家長與學生必須先被老師邀請並建立有效連結，不能單純切換介面角色取得權限。共同排課經 `shared_course_action` RPC 驗證使用者與學生關聯；老師原有的出席和付款流程保持獨立。

**實務限制與已知狀態：**

- 三個不同真實 Google 帳號的跨裝置端對端（E2E）測試，尚需正式完成；自動單元回歸測試不等於真人驗收。
- 目前改動後主要透過重新載入取得別人的最新操作，尚未宣稱具備即時推播或 Email 通知。
- 已完成、付款中或已結算課程不得透過家庭共同排課功能直接刪改。
- 固定課表可選多星期；改動日期時單一星期與新日期連動，多星期的人工選擇應保留。細節見 [V3.3 排課設計及驗收清單](docs/v33-shared-course-management.md)。
- 目前**沒有**導入訂閱費、線上刷卡收款、跨老師的團隊共同管理或自動搬移舊 GAS/Sheets 歷史資料。

## 開發與測試

1. 建立 GitHub 分支並修改 `v2/` 程式或 `supabase/migrations/`，避免直接在正式 `main` 試驗。
2. 本機執行 `node --test tests/*.mjs`。GitHub Actions 工作流程位於 `.github/workflows/v3-regression.yml`，每次提交 PR 或合併 main 會自動測試。
3. 如果新增 SQL migration，**必須另外透過 Supabase 審查與套用**，避免「前端已發布但 RPC 不存在」。
4. 通過自動測試後合併 PR，確認 Vercel 對應 commit 部署成功。
5. 使用獨立的老師、家長、學生測試帳號及測試學生，完成新增、改期、取消、跨裝置同步、取消連結與帳務隔離驗收。不要用正式學生或已付款課程測試。

## 安全規範

- 瀏覽器只放公開的 Supabase publishable key，**絕不能**在前端或 GitHub 提交 `service_role` 或私密金鑰。
- 外部資料表使用 RLS；存取權限必須按實際學生關聯驗證，而不是依介面上顯示的老師／家長／學生模式判斷。
- 有意開放給 `authenticated` 的 `SECURITY DEFINER` RPC 仍會被 Supabase Security Advisor 標示警告；不應為了消除警告而直接停用必要功能。逐一說明見 [V3.3 安全檢查](docs/v33-security-audit.md)。
- 停用不再使用的舊學生快照 RPC 公開執行權限。密碼洩漏防護屬 Supabase Auth 設定，應由管理員核對 Email／Password 是否啟用及方案限制。
- 任何更動正式資料、刪除、匯入或重新結算前都應先備份、驗證且取得適當授權。

## 其他技術文件

- [V3.4 三方共同排課穩定性與驗收](docs/v34-shared-schedule-validation.md)

- [V3.3 三方共同課程管理](docs/v33-shared-course-management.md)
- [V3 人性化課程與收付款流程](docs/v3-human-friendly-ux.md)
- [V3 獨立家教工作空間](docs/v3-multi-tenant-ux.md)
- [V2.7 工作空間與 RLS](docs/v27-personal-workspaces.md)
- [V2.6 安全維護](docs/v26-security-and-maintenance.md)
- [舊版 GAS／Sheets 專案備份](docs/legacy-readme-20261019.md)
