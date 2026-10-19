# 好好上課 V2 — 使用與部署說明

> **V2.5 安全維護版（2026-10-20）**：維持現有課表、家長申請、時間彈窗與自選區間付款功能。已修正跨使用者 RLS、補齊權限和索引，加入已收款刪除防護與 Supabase 分頁載入。完整變更與可重播 SQL 見 [維護稽核文件](../docs/v26-security-and-maintenance.md)。

## V2.5 預覽模式「操作未完成」修復（2026-10-20）

修正月曆重繪函式：更新每個日期格的上課堂數時應使用 `querySelectorAll` 選取多個元素，而非 `querySelector` 的單一元素，否則儲存資料成功後重新繪製頁面會拋出 `.forEach is not a function`。已用模擬預覽使用者完成回歸測試（預排課程 → 實際時數 1.2 小時 → 正確存入本機預覽資料 → 彈窗關閉，沒有錯誤提示）。原本的預覽資料保留，不需要重置。

## V2.5：月曆課程彈窗與實際上課時數（2026-10-20）

- 點月曆上的單堂課直接開啟原頁面的彈窗，**不開新分頁，也不顯示課程應收金額**。手機、電腦共用此操作；單一天有多堂時先選要編輯的課程。
- 保留預定開始／結束時間，老師在完成上課時預設沿用預定時間與時數。可另外修改實際開始、結束時間，或直接輸入 1.2、1.5、2.5 等小數時數。
- 實際應收金額在帳務頁按確認後的計費時數計算。家長仍可自行選擇任意起訖日期付款，不限月底。
- 老師能對過去或未來的單堂課標記學生請假、老師停課，並保留原始安排紀錄。家長可由同一彈窗提出事後請假或已完成課程的時間更正，由老師審核。
- 已進入付款／收款流程的課程，不允許直接變更時數或取消；資料庫也有防護。取消的課程不納入實際上課時數與應收款。
- 預覽模式只用瀏覽器本機資料，正式跨裝置同步與家長權限仍需先完成 Google OAuth、真實帳號測試。
- 僅修改 V2，V1／GAS／Google Sheets 保持不變。

**檢查順序**：老師點單堂 → 保留預定時間完成 → 修改實際時數 → 事後請假 → 家長提出時間更正 → 老師在帳務核准 → 再檢查 V2.3 指定期間付款是否依正確時數計費。

## V2.3：指定課程期間付款及收款（2026-10-20）

V2.3 將原本「單月批次處理」改為**任意起訖日期的區間付款流程**：

- **家長**：在「帳務」點「選擇期間回報已付款」，選擇學生和課程開始／結束日期（最多 730 天，可跨月）。系統只列出該期間已完成、尚有付款餘額的課程，並自動計算堂數、時數、應付金額。
- **部分付款**：家長輸入實際支付金額與日期；可少於應付總額，按課程日期由舊到新分配款項。餘額不會被誤標為已付。
- **老師**：在「帳務」查看相同課程區間、各筆付款批次以及每堂款項分配；核對實際銀行入帳後，輸入收款日期並按「確認這段期間已收款」，也可退回錯誤回報。
- **雙方共同可見**：期間起訖、家長實際付款日、老師確認日期、金額、狀態（待老師確認／已收款／退回），可展開查看各堂課分配。不同學生分開結算，不混淆家庭。
- **避免重複付款**：待確認和已確認批次佔用金額；只有剩餘未付金額能再次回報。資料庫端會使用交易、鎖定與權限檢查，拒絕超額／不相關家長操作。
- **舊功能**：保留單堂課請假及舊版單堂付款紀錄；新版單堂付款按鈕也可直接開啟指定當日的期間付款表單。
- **安全**：所有新增的公開資料表均啟用 RLS。家長無權直接寫入付款分配資料表，也無權確認老師收款；所有寫入經授權 RPC。完成結算的課程有額外資料庫更新保護。
- **環境**：新表 `public.payment_batches`、`public.payment_batch_items`；內部授權函式在 `tutor_private`，前端透過公開的 `submit_range_payment` 與 `review_range_payment` RPC 執行操作。

### V2.3 驗收步驟

1. 開啟 `/tutor-app/v2/`，選「互動預覽」，切換家長；到「帳務」點「選擇期間回報已付款」。
2. 選一位已排課學生、跨月或當月的起訖日期，確認已完成的課程與餘額；輸入部分付款金額及實際付款日期。
3. 按「確認這段期間已付款」，到「期間付款／收款紀錄」展開核對分配，並確認已佔用的金額不可重複支付。
4. 切換老師檢視，在同一紀錄按「確認這段期間已收款」，填實際收款日期；應更新已收款金額，但部分支付的剩餘款項仍待結算。
5. 測試錯誤回報退回後，未支付餘額重新恢復；測試跨月、兩筆部分付款合併結清。
6. **真實驗收待辦**：Google OAuth 設定完成後，用不同 Google 帳號驗證家長／老師權限、同一個課程區間的資料同步與入帳流程；確認手機與電腦操作一致。尚未進行真實個資及真實銀行交易測試。

> 互動預覽的資料仍僅儲存在目前瀏覽器，不會在手機與電腦同步。正式同步需使用 Supabase Auth。**本次未更動 V1/GAS/Google Sheets，也沒有搬移真實家教或付款資料。**


## V2.2：手機與電腦一致性（2026-10-19）

- **同一個月曆資料來源**：手機和電腦均支援「▦ 月曆／☷ 課程清單」切換。兩種顯示都使用相同的學生、課程日期、上課時間、狀態與 RLS 權限。
- **月曆模式**：電腦日期格顯示課程標籤；手機日期格顯示課程堂數，並在下方「本月課程一覽」直接顯示學生名稱、上課時段與課程狀態，不用逐日點開。
- **清單模式**：手機和電腦皆可以按日期查看整個月份的課程，點「管理當日」開啟相同的操作面板。老師、家長功能仍依帳號權限顯示。
- **固定課表修正**：修復原本週一～週日複選框，以及修改課表範圍的元素查詢錯誤。
- **預覽資料的限制**：互動預覽使用瀏覽器本機的 localStorage，不會跨手機、電腦同步，且兩台裝置可能各自保留不同的老師／家長檢視選擇。這並非 Supabase 資料同步故障。正式跨裝置同步需完成 Google OAuth 並以相同登入帳號進行實測。
- **版本**：V2.2 仍放在 GitHub Pages `/tutor-app/v2/`，原 V1 的 GAS + Google Sheets 不變。無須使用 Vercel。

### 尚需使用者手動完成的設定

| 項目 | 說明 |
| --- | --- |
| Google Cloud OAuth | 建立 Web application 類型 OAuth Client ID；JavaScript origin：`https://zhichiangai.github.io`；Authorized redirect URI：`https://vctisuglfoxyuwlvyjee.supabase.co/auth/v1/callback` |
| Google 同意畫面 | 設定應用名稱、Audience 與必要的 `openid`、email、profile 權限；若測試狀態，加入老師與家長測試 Gmail 帳號 |
| Supabase Google Provider | 到 Supabase Dashboard 的 Auth → Providers → Google 啟用，填入 Client ID 與 Client Secret（**絕不能將 Secret 提交至公開 GitHub**） |
| Supabase Redirect URLs | Auth → URL Configuration 設定 Site URL 及 Redirect allowlist：`https://zhichiangai.github.io/tutor-app/v2/` |
| 多帳號權限驗收 | 用兩個真實 Google 帳號驗證：老師新增課程→邀請家長→家長登入接受邀請→請假／付款申請→老師審核。Google 登入在完成這些設定前不可視為已正常運作 |
| 舊資料遷移 | 未執行，只有確認所有新流程安全且備份後才能規劃切換；不要在測試期間刪掉 GAS 舊資料 |


> 狀態：**獨立 V2 版本／可互動預覽**。不要誤認為舊站已轉移；舊站仍然由 GitHub Pages + GAS + Google Sheets 運作。

## 網站

- 正式舊站：<https://zhichiangai.github.io/tutor-app/>
- V2 預覽路徑（本資料夾部署到 main 後）：<https://zhichiangai.github.io/tutor-app/v2/>
- Supabase 專案：<https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee>
- Github：<https://github.com/zhichiangai/tutor-app>

## 設計原則

**主 C Todoist × 副 A Notion Calendar**：暖白底色、珊瑚橘色主按鈕、留白優先、簡單的 4 個導覽入口（今天、月曆、帳務、學生）、手機底部分頁。
優先提升常用操作：新增課程、每週／雙週／每月預排、確認上課、付款／請假申請和收款確認。所有預覽操作不影響真正的資料庫。

## 目前 V2 的操作能力

| 模式 | 功能 |
|---|---|
| 互動預覽 | 不登入即可試用；資料只存此瀏覽器的 localStorage |
| 老師登入（Supabase） | 新增學生、固定排課、編輯課程、標記上課、確認收款、邀請家長、審核請假／付款申請 |
| 家長登入（Supabase） | 接受家長邀請、查看已授權學生的課程、提出請假／付款申請 |
| Supabase RLS | 老師只能管理自己的學生／課程；家長只看有邀請授權的學生；家長不得直接修改老師收款 |
| 尚未上線 | Google OAuth Client ID / Secret 的 Google Cloud 設定、正式 OAuth 實機驗收、舊 Sheets 資料遷移 |

## V2.1：月曆與固定課表（2026-10-19）

本次已修改 V2 的月曆操作與 Supabase 架構：

1. 月曆點任一日期，立即開啟「當日安排」；可直接新增單次課程或固定課表。沒有排課的日期不需要標記停課。
2. 「固定課表」可以選擇學生、科目、每週上課日（多選）、每週或雙週、開始與結束日期、時間與鐘點費。規則動態顯示在未來月曆上，不會無限制建立未來課程。
3. 單次修改：已排定的課程可「完成上課」、「編輯」、「改期／請假」。改期不影響其他週，原日期仍可看見改期提示。
4. 修改固定規則：可自指定日期起套用新規則，也可以編輯整組規則。已存檔的實際上課紀錄與付款不會被重新生成或覆蓋。
5. 家長可提出請假，老師核准後才調整月曆。上課時數與應收費用僅計入「已完成上課」。
6. 已確認收款的課程不允許直接改期／取消或編輯鐘點費，避免破壞歷史對帳。

資料結構：recurring_schedules 儲存固定規則；schedule_exceptions 儲存單堂請假與改期；lesson_records 儲存已確認或單堂編輯的課程。所有表格啟用 RLS，並透過學生／家長授權關聯限制讀取。

已通過 JavaScript 語法、DOM 元件對應、純函式週期運算與資料庫安全檢查。**仍未完成真實 Google OAuth、手機／電腦瀏覽器實際操作及兩個真人帳號端到端驗證**，不可將此狀態視為正式環境驗收。

## Google 登入：必須由專案擁有者完成一次設定

此專案前端已使用 Supabase Auth 的 `signInWithOAuth({provider:'google'})`，但 Google 提供者的啟用與密鑰需在 Google Cloud + Supabase Dashboard 設定，**不能只因為看見「使用 Google 登入」按鈕就認為已可登入**。

1. 開啟 [Google Auth Platform](https://console.cloud.google.com/auth/overview)，選擇或建立適合本專案的 Google Cloud Project。
2. 在 OAuth 同意畫面設定應用名稱、使用者類型及授權測試使用者（若仍為 Testing）。設定基本 `openid`, `email`, `profile` scopes。
3. 建立 **OAuth Client ID → Web application**：
   - **Authorized JavaScript origins**：`https://zhichiangai.github.io`
   - **Authorized redirect URI**：`https://vctisuglfoxyuwlvyjee.supabase.co/auth/v1/callback`
4. 進入 [Supabase Google Auth Provider](https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee/auth/providers) 的 Google，啟用並輸入 **Client ID** 與 **Client Secret**。**不要將 Secret 貼到 GitHub 或 ChatGPT 聊天紀錄**。
5. 開啟 [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee/auth/url-configuration)：
   - **Site URL**：`https://zhichiangai.github.io/tutor-app/v2/`
   - **Redirect URLs**：加入精確的 `https://zhichiangai.github.io/tutor-app/v2/`
6. 在電腦及手機各開啟 V2 網頁，實測：Google 登入→老師新增學生→家長收到 Email 對應的邀請→家長登入接受→課程唯讀→請假及付款申請→老師確認→再次登入資料仍存在。

> 同一個 Google Email 可能同時持有老師和家長身分，但能讀／寫哪些資料**始終由資料庫 RLS 依資料關聯判斷**；畫面角色切換不會取得他人的存取權限。

## 系統架構

```
GitHub Pages /tutor-app/v2/ (HTML/CSS/JavaScript)
  ├─ Demo mode -> localStorage（不連資料庫）
  └─ Live mode -> Supabase Auth (Google OAuth)
                  -> Supabase Data API (publishable key)
                  -> PostgreSQL / Row Level Security
                       ├─ students
                       ├─ lesson_records
                       ├─ guardian_invites
                       ├─ student_guardians
                       └─ family_requests
                           └─ review_family_request()（後端原子審核）
```

公開前端僅含 **Supabase project URL 與 publishable key**，不應包含 **secret / service_role key**。
新的 Supabase 資料表目前是空的。原本 Google Sheets 課程與付款資料**沒有被複製或更動**。

## 權限模型與資料表

- `students.teacher_id`：老師建立的學生資料，存常用科目、鐘點費。
- `lesson_records.owner_id`：老師擁有課程。另有 `student_id` FK，強制學生屬於同一個老師。
- `guardian_invites`：由老師指定學生與家長 Google Email；僅老師及該 Email 已登入的使用者可見。
- `student_guardians`：家長使用符合邀請 Email 的驗證帳號接受邀請後，建立學生－家長關聯。
- `family_requests`：家長提出請假或付款申請，老師審核。正式狀態需透過伺服器端 `review_family_request` 交易更新，避免部分成功。

所有上述資料表已啟用 RLS。請勿為了方便而停用 RLS。教師、家長的 Email 與付款資訊屬於私有資料，不能出現在 GitHub 公開儲存庫。

## 資料對接與舊站注意事項

- 舊 GAS `HEADERS` 共 20 欄，V2 使用 snake_case；例如 `date` → `lesson_date`、`hourlyRate` → `hourly_rate`。
- 現在是**並行準備**而不是正式遷移。Google Sheets 仍是舊站資料來源。
- 遷移前需要備份、測試欄位轉換、資料筆數核對、付款對帳及回滾演練。
- 開發修改請先使用分支與 PR，不要覆蓋既有 `frontend/` 與 `backend/apps-script/`。

## 基本驗收清單

- [x] V2 前端與手機 RWD 樣式已加入 GitHub
- [x] 原 GAS / Sheets 程式與正式站未修改
- [x] V2 課程及家長授權資料表與 RLS 已部署
- [x] Supabase Security Advisor 無警告（2026-10-19 查詢）
- [ ] 真正的手機／桌面瀏覽器視覺驗收
- [ ] Google Cloud OAuth 設定與登入測試
- [ ] 兩個不同 Google 帳號（老師／家長）的完整端到端測試
- [ ] Supabase 實際新增、編輯、刪除課程測試（目前尚無真實登入測試）
- [ ] GAS / Sheets → Supabase 的完整資料核對及正式切換

## 使用者體驗規範

- 首頁只顯示下一堂課、當月時數、待確認款項；不放沒有價值的大型圖表。
- 老師／家長擁有不同動作與文案；不要求使用者重複輸入資料。
- 請假與付款由家長提交，老師審核，避免因誤按直接影響帳目。
- 網路錯誤必須明確告知，不可提示「已儲存」。
- 付款和刪除等關鍵操作以確認或明確回饋取代過度動畫。
- 動態預覽資料為假資料；不要在公開 Demo 輸入個資。
