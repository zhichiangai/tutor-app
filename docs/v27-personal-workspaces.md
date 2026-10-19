# 好好上課 V2.7：獨立老師的多人共用平台（2026-10-20）

## 實作範圍

將原本單一老師使用的 V2.5，保留操作方式升級為可讓不同老師自行加入、各自擁有資料的工作空間架構。**這次沒有收取軟體訂閱費、學生數上限、團隊共同編輯、多老師主管、家教費代收與分潤。**

保留：Google OAuth、每週／雙週課表、請假改期、實際時數／小數時數、家長時間更正、指定日期區間付款、部分付款、教師確認收款、已付款課程鎖定及 V1/GAS/Google Sheets。

## 新老師第一次使用

1. 開啟 `/v2/` 並以 Google 帳號登入。
2. 在帳號設定選擇「我是老師」。
3. 尚未擁有工作空間時，首頁會顯示建立引導；也可在帳號設定輸入「我的家教空間名稱」。
4. 按「建立家教空間」。資料庫驗證使用者身分後，建立且只建立一個個人工作空間，並自動建立不可自行提升或編輯的 owner membership。
5. 新增學生、固定課表與家長邀請；新資料的 `workspace_id` 由後端觸發器決定，而不是信任前端送入的 ID。
6. 未來可更新工作空間的顯示名稱，不會更動既有學生與課程的擁有權。

## 家長與多位老師

1. 老師在「學生與家長」新增學生，依既有流程輸入受邀家長的 Google Email，建立邀請。
2. 家長用相同 Email 的 Google 帳號登入，於「我是家長」頁面接受邀請。**此流程不會自動寄出 Email；老師需自行告知家長開啟網站。**
3. 同一位家長能接受 A、B 不同老師的邀請，不會因此讓 A 老師讀取 B 老師資料。
4. 當家長連結兩位以上老師，網站會出現「查看老師的課程」篩選器；選「全部老師」或指定老師，課程、學生、家長申請及付款批次跟著切換。
5. 同一帳號可以切換老師／家長介面，但資料庫權限不受前端角色按鈕影響。

## Supabase 模型

新增：
- `profiles(id,display_name,created_at)`：只可讀寫自己的基本顯示資料，顯示名稱不可用來授權。
- `workspaces(id,owner_id,name,kind,created_at)`：本階段一位老師最多一個私人空間。雖預留 `kind='team'`，客戶端只能建立 `individual`。
- `workspace_members(workspace_id,user_id,role,created_at)`：由安全的觸發器為新空間建立 owner 關聯；客戶端只能讀取自己的關聯，不能自行新增/更新 owner、admin、teacher 身分。

九張原有資料表 `students`、`lesson_records`、`guardian_invites`、`student_guardians`、`family_requests`、`recurring_schedules`、`schedule_exceptions`、`payment_batches`、`payment_batch_items` 均新增不可為 NULL 的 `workspace_id`。

**兼容舊客戶端：** 教師新增／修改資料時，DB trigger 根據既有 `teacher_id` 或 `owner_id` 設置 workspace ID；付款項目則依付款批次與課程核對工作空間。複合外鍵保證學生、課程、固定課表、家長連結與付款批次無法跨工作空間引用。原有 `teacher_id` 及老師/家長 RLS 保持有效。

### 實施與歷史資料

在原正式 Supabase `tutor-app`（`vctisuglfoxyuwlvyjee`）已執行兩筆**加法式 migration**：
- `v27_personal_workspaces_and_scoped_records`
- `v27_index_workspace_composite_foreign_keys`

GitHub 可回播的遷移：
- `supabase/migrations/20261020030000_v27_personal_workspaces.sql`
- `supabase/migrations/20261020031000_v27_workspace_fk_indexes.sql`

既有 Google 帳號的 `profiles` 已補齊；只為已經持有課程、學生及帳務紀錄的老師補建空間，並未把所有家長自動變成老師。原有課程與付款金額、狀態和日期不做變更。

## 測試與稽核

- `node --test tests/v2-regression.mjs tests/v27-workspace-regression.mjs`（需在有 Node.js 的環境執行）。
- `supabase/tests/v27_tenant_security_assertions.sql` 可於 Supabase SQL Editor 執行唯讀稽核。
- 已以 transaction + rollback 模擬真人授權角色建立新工作空間、繫結 owner membership、建立學生，**沒有留下測試資料**。
- 後端唯讀稽核驗證：九張業務表 workspace_id 均非空、RLS 啟用、每個老師資料歸屬一致、付款批次不跨空間、一般角色不能 INSERT/UPDATE membership 或改 owner_id。
- 前端模擬測試驗證：老師初次引導、原有教師讀取自己學生、家長連結兩位老師時切換學生與付款，以及 Google profile 自動補建。
- **未宣稱通過：** 兩位全新 Google 老師與同一位家長在真正手機/桌面上的完整 OAuth / 排課 / 付款 E2E。正式擴大邀請前仍應實測。

## 回復方式

功能程式透過 GitHub PR 合併到 `main`，若遇前端回歸問題可先復原該 PR 並重新部署；資料庫改造是**加法式**，舊版前端不傳 `workspace_id` 仍可透過觸發器正確建立新記錄。

切勿直接 DROP `workspace_id`、刪除 `workspaces`、清空 `profiles`，或因降版刪除正式的家長與付款紀錄。若需全面回復資料庫必須先完成獨立備份、檢查依賴並演練遷移。現階段不觸碰 V1、GAS、Google Sheets 或 Vercel 專案設定。

## 之後才考慮的功能

- 訂閱與收費
- 多位老師共同管理同一團隊
- 家長邀請 Email 自動寄送
- 完整學生資料歷史及帳務稽核
- 自動提醒與平台營運後台

以上不是 V2.7 發布前的必須條件，也不是此次已完成的功能。
