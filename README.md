# 家教計時器（tutor-app）

給家教老師與家長共同使用的**課程月曆、請假與收付款對帳工具**。

> **系統狀態（最後確認：2026-10-19）**
>
> - **目前網站**：GitHub Pages 前端 + Google Apps Script（GAS）API + Google Sheets。
> - **下一代後端（準備中）**：已建立獨立的 Supabase `tutor-app` 專案與基礎資料表，**尚未接入前端、尚未搬移正式資料**。
> - **重要**：不要把「Supabase 已建立」誤認為「網站已切換」。原有 GAS / Sheets 流程維持不變。
> - **部署方針**：使用 GitHub Pages；本專案**不使用 Vercel**。

## 連結

- [家教網站（GitHub Pages）](https://zhichiangai.github.io/tutor-app/)
- [GitHub 程式庫](https://github.com/zhichiangai/tutor-app)
- [Supabase 專案 Dashboard（登入後）](https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee)

以上網站網址為儲存庫既有部署位置；是否正常連線及最新部署狀態仍需以實際測試確認。

## 1. 目前正在使用的架構（Legacy / Current）

```text
老師 / 家長（瀏覽器）
          |
          v
GitHub Pages（靜態前端）
  frontend/index.html
  frontend/app.js
  frontend/style.css
          |
          | HTTP GET / POST
          v
Google Apps Script Web App
  backend/apps-script/Code.js
          |
          v
Google Sheets（課程、請假、付款紀錄）

瀏覽器 localStorage：
- 儲存介面偏好、GAS URL、本機紀錄/雲端備份
- 不是可信的身分驗證或權限邊界
```

- 前端採原生 HTML、CSS、JavaScript，未使用大型前端框架。
- GAS 的 `doGet()` 提供讀取；`doPost()` 處理新增、修改、刪除與批次付款狀態更新。
- GAS 使用 `SpreadsheetApp.getActiveSpreadsheet()` 取得所連結的試算表。
- Google Drive 曾找到與 GAS 20 欄資料結構相同的「Rapid4Grad 家教帳本」，但**尚未驗證是否就是正式 GAS 使用的那一份**。
- 現有「老師／家長模式」主要為前端 UI 模式，**不是已完成的伺服器端權限控管**。

## 2. 規劃中的新架構（Supabase / Not yet production）

```text
老師 / 家長（瀏覽器）
          |
          v
GitHub Pages（沿用靜態前端）
          |
          +--> Supabase Auth（規劃老師 / 家長登入）
          |
          +--> Supabase PostgreSQL
                   public.lesson_records
                   RLS（已啟用）
```

**Supabase 已確認狀態（2026-10-19）：**

| 項目 | 現況 |
| --- | --- |
| 專案名稱 | `tutor-app` |
| Project Ref | `vctisuglfoxyuwlvyjee` |
| Organization | `rapid4grad`（與 RAPID4GRAD 各自獨立專案 / 資料庫） |
| 區域 | `ap-northeast-1`（東京） |
| 健康狀態 | `ACTIVE_HEALTHY`（查詢時） |
| 已建立資料表 | `public.lesson_records` |
| 現有資料列 | **0 筆**（查詢時） |
| RLS | **已啟用**；已建立資料擁有者 CRUD 政策 |
| 前端 Supabase SDK / Auth | **尚未整合** |
| 老師與家長共享權限 | **尚未設計完成** |
| 舊資料遷移 | **尚未開始** |
| 正式系統切換 | **尚未進行** |

目前的 `lesson_records` 以 `owner_id`（參照 `auth.users`）設定資料擁有者，並有 SELECT / INSERT / UPDATE / DELETE 的 owner-only RLS 政策。這是安全的初始隔離模型，**尚不支援家長與老師共同管理同一堂課**；不得直接將其視為已完成的多角色授權。

### 舊 GAS / Sheets 欄位與 Supabase 對照

原 GAS 的主要欄位包括：

`id`, `type`, `leaveSource`, `paymentGroupId`, `date`, `student`, `subject`, `startTime`, `endTime`, `hours`, `hourlyRate`, `totalAmount`, `status`, `paymentDate`, `receivedDate`, `parentNote`, `remarks`, `focusRating`, `attitudeRating`, `updatedAt`。

> 原格式實際是 **20 欄**：上述欄位以 GAS `HEADERS` 為準。新資料表採 snake_case（例如 `date` → `lesson_date`、`hourlyRate` → `hourly_rate`），另有 `owner_id`、`legacy_id`、建立與更新時間。匯入時需要明確轉換，不能直接把舊資料原樣 INSERT。

目前僅建立單一課程紀錄表，學生、家長關聯、授權與付款分表等**尚未定案**；後續應在需求和 RLS 規則明確後再擴充。

## 3. 主要功能（既有程式）

- **月曆總覽**：每日課程、請假、付款狀態。
- **老師模式**：記錄上課、預排課程、請假、確認收款。
- **家長模式**：查看課程、請假、確認付款。
- **重複排課**：單次、每週、雙週、每月、指定結束日。
- **對帳**：上課時數、鐘點費、金額、付款狀態與備註。
- **同步與備援**：GAS / Sheets 雲端資料，加上瀏覽器本機記錄或備份。

上述代表 GitHub 原始碼中已有相關功能；**不代表所有情境都已完成實機驗收**。

## 4. 儲存庫結構

```text
tutor-app/
├── frontend/
│   ├── index.html        # 網頁 UI
│   ├── app.js            # 月曆、課程、付款、GAS 呼叫
│   └── style.css         # 版面與視覺樣式
├── backend/
│   └── apps-script/
│       ├── Code.js       # GAS Web App API + Sheets 讀寫
│       └── appsscript.json
├── index.html            # 根目錄跳轉至 frontend/index.html
├── .gitignore
└── README.md
```

## 5. 開發與部署

### 前端（目前）

1. 修改 `frontend/`，先在分支測試。
2. 建立 PR、檢查無誤後合併到 `main`。
3. 依現有 GitHub Pages 設定，從 `main` 的根目錄提供靜態網站。
4. 實際開啟頁面確認：月曆、表單、請假與付款流程是否正常。

### GAS 後端（目前）

1. 後端原始碼置於 `backend/apps-script/`。
2. 正式 GAS 部署**不會因 GitHub Pages 更新而自動改版**。
3. 需要有權限的 Google 帳號透過 `clasp` 或 Apps Script 管理介面推送程式、建立版本、更新部署。
4. **GitHub Actions 自動部署 GAS 尚未建立與驗證**，請勿假設已自動同步。

### Supabase（尚未切換）

1. 先確認老師／家長帳號、學生關聯及資料讀寫權限規則。
2. 完成資料模型、RLS 與 Auth 流程，於測試環境驗證。
3. 修改前端 API 串接，先使用測試資料檢查完整 CRUD 與付款流程。
4. 備份 Google Sheets 並進行欄位轉換、數量比對與還原演練。
5. 完成驗收後才考慮正式切換；切換前**GAS / Sheets 持續是既有系統**。

## 6. 安全與資料保護

- **不可**將學生個資、家長聯絡資料、付款細節、Google OAuth 憑證、`service_role` / secret key 提交至公開儲存庫。
- 前端只允許使用 Supabase publishable key；**不能**在瀏覽器放入 secret / service role key。
- Supabase 所有對外資料表必須啟用 RLS，且以實際使用者與資源關聯檢查授權；不能只判斷「已登入」。
- 現有 GAS `appsscript.json` 設定為匿名可存取，`Code.js` 亦未提供完整的伺服器端身分驗證。**在完成保護前，應視現有 GAS URL 及資料 API 為高風險存取路徑。**
- 任何資料遷移、覆蓋正式部署或刪除舊資料前，必須先備份並取得明確確認。

以下檔案不應公開提交（現有 `.gitignore` 已排除）：

- `note/`
- `策略MD合集/`
- `.clasp.json`
- `.DS_Store`

## 7. UI / UX 設計方向（待選定）

希望做成**乾淨、漂亮、具有質感、手機友善**的家教課程工具。以下僅供風格參考，**尚未選定也尚未實作**：

- [Notion Calendar](https://www.notion.com/zh-tw/product/calendar)：極簡、以月曆為中心。
- [Linear](https://linear.app/)：精準間距、專業 Dashboard。
- [Todoist](https://www.todoist.com/zh-TW)：溫暖簡潔、易上手的任務操作。

設計原則：課程一眼可見、老師與家長操作清楚、手機優先、付款狀態可辨識、避免過度裝飾。視覺方案需在確認參考風格後再正式定稿。

## 8. 協作原則（ChatGPT × Codex）

- **GitHub** 是前後端原始碼的共同版本來源，**不**代表它自動擁有 Google 端正式部署版本。
- **ChatGPT**：閱讀程式與資料庫結構、規劃需求、審查 GitHub PR、協助 Supabase SQL 與權限檢查。
- **Codex**：多檔案修改、本機測試、Git 分支、PR、部署腳本。
- 涉及前端 / GAS / Supabase 同時修改時，優先分階段開發，避免一次改動正式來源與目的端。
- 新功能應先列出：需求、資料欄位變更、權限、測試方式、回滾方法；通過驗收再部署。

## 9. 待辦優先順序

1. 決定 UI 視覺方向並完成手機 / 桌面頁面規劃。
2. 設計老師、家長與學生的關聯及 RLS 權限，不讓家長修改老師收款確認。
3. 完成 Supabase Auth 和前端串接的獨立測試環境。
4. 建立 GAS → Supabase 資料轉換與備份、比對機制（尚不匯入正式資料）。
5. 功能與安全測試通過後，再決定正式上線與舊系統退場時間。

---

**更新紀錄：2026-10-19** — 記錄既有 GAS / Sheets 架構，以及新建立但尚未上線的 Supabase 架構。本次 README 更新僅為文件變更，不代表功能已完成遷移。
