# V3.5.4：老師的學生管理 — 以學生為中心的頁面

## 已完成介面

「學生與家長」頁在老師模式改為**學生管理**：

1. 顯示學生總數、已有家長連結的學生數、仍有待接受邀請的學生數。
2. 一位學生一列：姓名、主要科目、預設時薪、學生帳號／家長帳號狀態、管理按鈕；可依姓名／科目搜尋，按已連結／等待接受／尚未邀請篩選。
3. 點擊學生開啟同頁彈窗：姓名、科目、未來課程預設時薪；學生的 Google Email 邀請／連結狀態；家長邀請與連結（支援多位家長）。
4. 尚未接受的家長邀請可修改 Email 或撤銷；已接受的家長連結可解除。學生帳號可撤銷邀請，或在已連結後解除查看權限。
5. **解除連結會二次確認**，清楚告訴老師「只撤銷帳號查看權限，學生、課程、付款與課後紀錄都保留」。
6. 家長模式保留既有的孩子學習紀錄和接受老師邀請的功能，不使用老師的學生管理面板。

## 資料與計價界線

- 新版姓名、科目、預設時薪只透過 `public.students` 的本人老師 `teacher_id` 條件寫入 `name/subject/hourly_rate` 三個欄位。
- **預設時薪修改只影響後續新增課程的預設值**，不更新現有 `lesson_records`、已收款、付款批次及稽核紀錄。
- 帳號狀態來自後端真實資料：`student_invites`（新版邀請）、`student_invitations`（舊邀請）、`student_links`（已接受學生帳號）、`guardian_invites` 與 `student_guardians`（家長連結）。
- 已接受學生邀請後，**只刪 `student_invites` 無法撤銷授權**：實際 `student_links.invitation_id` 指向 `student_invitations.id`。V3.5.4 修正此舊版缺陷，需使用新 RPC 同筆交易處理。
- 若存在無法對應原始邀請的學生帳號，顯示「連結待確認」，不隨意推定可解除哪個帳號。

## 上線前的 Migration 關卡（重要）

新增草稿：`supabase/migrations/20261022113000_v354_student_account_disconnect.sql`。

`public.revoke_student_account_connection(p_student_id uuid,p_email text)`：

- `SECURITY INVOKER`、空 `search_path`；只允許 authenticated 呼叫，拒絕 anon。
- 核對 `auth.uid()` 為該學生所屬老師，尊重既有 RLS／DELETE 權限。
- 同一 PostgreSQL transaction 中撤銷新版／舊式邀請；舊式邀請的 FK ON DELETE CASCADE 同時撤銷真正的學生登入權限。
- 刪除邀請與連結後，**保留學生資料、原有課程、已收款及所有歷史帳務**。

**目前僅建立 SQL 檔，尚未套用正式 Supabase。請勿只合併前端就發布。** 上線時應先備份、審核及套用 RPC Migration，核對安全／權限與所有歷史資料，再部署相符的前端。未套用 Migration 前，預覽版的「解除學生連結」請勿視為可用，也不得拿正式學生測試。

## 已完成驗證

- 在正式 Supabase 使用 `BEGIN; candidate migration; fixture; ROLLBACK;` 測試：真實 authenticated 老師可撤銷接受後的學生查看權限；他人老師被阻止；待接受邀請能撤銷；保留課程與原始計價；修改學生預設時薪不影響原課程金額。
- GitHub Actions 執行 `node --test tests/*.mjs`，新增管理清單與篩選、跨老師學生資料隔離、同一學生多位家長、連結真實狀態、邀請、修改預設時薪、解除權限 RPC 參數和登出清理的回歸測試。
- 尚須 Codex 內建瀏覽器驗收老師清單／學生詳細彈窗、手機觸控、家長原有介面；最終驗證連結解除必須在 Migration 過審套用後，以**獨立 QA 帳號與資料**測試。

## 正式使用資料保護

不允許修改真實學生的連結、課程、家長付款與收款。既有 QA 課程 `58968187-17ff-4697-95e1-bc6d070aafdd` 必須維持原時數、費率、金額與評分，不能被本次 UI 驗收改動。
