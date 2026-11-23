# RAP-49 — Team 學生身分連結、個人課程與跨 Team 隔離（設計候選）

> 日期：2026-11-23（Asia/Taipei）  
> 範圍：既有 V5 Team 多老師 / 多專案 + V4 個人家教學生入口  
> 狀態：**RFC / NOT IMPLEMENTED**。此檔只描述設計，不授權任何 Production Migration、RLS、Auth、付款或 Main 發布。  
> Issue：RAP-49，關聯 RAP-48。RAP-12 的正式 GUI 教師／管理者隔離已獨立 PASS。

## 1. 問題與既有證據

Production Main `996d57655a4cc919a16a7464eb2cf646de3467e8`、62 migrations：

- `public.v5_team_students` 只有 Team 學生資料與建立者，**未記錄真正的 Supabase Auth 使用者身分**。
- `public.v5_team_enrollments` 只連結 Team 學生、Team 與 Project；不能據此推定已登入 Auth User 對課程有權限。
- `v2/v5-learning.js` 僅在 `getRole()==='teacher'` 顯示 Team 課程；`v2/app.js` 初登入判斷 `isStudent` 依據是 V4 `studentLinks/studentInvites`，不是 V5 Team。
- 現行 Team Lessons / Students 的 RLS 對 Manager、已指派老師有效，但**沒有經查證的 Team 學生正向讀取流程**。
- 已有 RAP-48 虛構測試課程：A Shared Math、A Private Science、B Shared English。D／E 是 Team A 不同學生、H 是 Team B 學生；各為**獨立 Auth User**且 Email 已確認，**尚無合法 Team Student 連結**。
- PR #96 的隔離 GoTrue 真 JWT 檢查 D/E/H 目前無權讀取 Team 資料 PASS，這是**負向拒絕**，不是學生功能完成。

## 2. 使用者可理解的預期體驗

1. **管理者邀請**：A 選擇 Team A 已建立的學生與學生本人 Email，按「邀請加入學習頁」。F 對 Team B 類似。老師 B/C/G 不可代管理者建立學生身分授權。
2. **學生本人接受**：D/E/H 以本人的 Email／密碼登入，看到待確認的邀請，按「接受」後，才建立 Team Student ↔ Auth 身分關係；若 Email 不符、尚未確認或邀請過期，必須拒絕。
3. **學生個人頁**：D 只看 A Shared Math；E 只看 A Private Science；H 只看 B Shared English。顯示科目、日期、時間、課程狀態與可公開的學習內容；**沒有管理、時薪、費用、應收、付款、退款及其他學生資訊**。
4. **解除連結**：管理者可撤銷指定身分。撤銷後，原 Auth 身分在同一個尚有效的 JWT 中對後端重新查詢也不能再取得課程；前端同步清空快取、返回可理解的未連結狀態。
5. **共存**：已存在的 V4 學生、家長、老師共用登入和個人家教資料維持原有流程；Team Student 是新增的正當授權來源，不取代 V4 的老師／學生連結。

## 3. 後端候選架構（不直接套用）

### 3.1 身分映射及邀請

在**獨立 Migration 候選**建立受限、可稽核的資料模型，可使用 `tutor_private` 私有 Schema：

- `v5_team_student_auth_invitations`：`id`、`team_id`、`student_id`、經標準化的 `recipient_email`、`invited_by`、`created_at`、`expires_at`、`accepted_by`、`accepted_at`、`revoked_at` 等。Team/student 一致性須由複合 FK 或明確鎖定驗證，避免跨 Team 指向錯誤學生。
- `v5_team_student_auth_links`：`team_id`、`student_id`、`auth_user_id`、`invitation_id`、`linked_at`、`revoked_at`。Active link 的一個 Team Student ID 只能對應一個 Auth User；歷史保留，不刪除審計。
- 可併設 immutable 事件審計，至少紀錄邀請、接受、拒絕、撤銷；不能紀錄密碼、JWT、Cookie、原始 Session。
- 直接 Data API 表格存取採 **default-deny**。只開放有充分 RLS／管理者操作界線的必要入口；避免直接暴露私有身分映射與其他學生 Email。

### 3.2 邀請與接受 RPC（僅列操作契約，函式名稱為候選）

- `v5_invite_team_student(p_student_id, p_email)`：須有 `auth.uid()`、Team plan、現任 Team Manager、有效學生歸屬；建立有期限的邀請並回傳最少資料。需處理重複、已存在 Active link、離職管理者或不同 Team 學生等案例。
- `v5_my_pending_team_student_invites()`：使用已確認的 Auth Email 自動比對未過期邀請。**無論當前 UI role 是 teacher 或 student，都能發現自己的邀請**。不能以可編輯 `user_metadata` 判斷身分。
- `v5_accept_team_student_invite(p_invitation_id)`：在單一交易鎖定 invitation、Team/student，核對實際 `auth.users.id` 和 `email_confirmed_at`、lowercase Email、本身尚未接受、未到期、Team 未封存；建立 Active link，記錄稽核。偽造其他人的 `auth_user_id` 必須不可能。
- `v5_revoke_team_student_link(p_link_id)`：只允許現任該 Team 管理者，撤銷後立即對**資料庫新的讀取**生效（包括既有 JWT）。不能只移除前端按鈕而保留後端讀取權。
- 若使用 `SECURITY DEFINER`，須明確 `SET search_path TO ''`、必要的 `auth.uid()` 和 Team 綁定校驗、限制 `EXECUTE`、逐一審核錯誤訊息與競態；**不能將函式權限簡化成 `TO authenticated` 即可讀所有行**。

### 3.3 學生專用唯讀課程 API

**優先以專用 Student Lesson Cards RPC / security-invoker RLS 視圖介面返回欄位白名單**，不要直接對學生開放整張 `v5_team_lessons`（內含 `notes`，可能是老師私人備註）。

- 客戶端不傳想看的任意 `student_id` 作授權依據。伺服器從 `auth.uid()` → active link → Team/Student → Enrollment/Lessons 推導可見資料。
- 白名單例：`lesson_id`、`subject`、`lesson_start`、`lesson_end`、`status`、可對學生公開的 Project Name；如要顯示老師稱呼須另採最小公開 Profile 欄位。**不得返回 `hourly_rate_cents`、`amount_cents`、Payment、Refund、老師備註、其他學生資訊、完整管理者 Email**。
- 原有管理者／受指派老師 Lesson、Project、Billing RLS 維持不變；Student API 不授權呼叫管理者 Billing/Payment RPC。若採 `SECURITY DEFINER` 投影需逐一驗證 search_path、函式權限和跨 Team 拒絕。

## 4. 前端行為與角色遷移

- Team 學生邀請入口必須在角色未選定時也可操作；**新 Auth 首登可能先被既有 `app.js` 標示 teacher**，不能要求先切到本來未啟用的 Student 模式才能接受邀請。
- 接受成功後，根據後端有效 link 開放 Student 模式，並在學生頁獨立呈現 Team Student cards；若帳號同時擁有 V4 連結，兩種資料要區分來源或合併但不得重覆／串 Team。
- 取消連結、帳號切換或登出要清除 Student Team cache，停止顯示舊 Lesson 卡片；網路錯誤應 fail closed，不呈現上一人資料。
- 保留原先 V4 學生頁／家長財務／老師課表功能。手機 320、375、390、430、768、1440px 避免溢出與底部導覽遮罩。

## 5. 必須通過的驗收案例

| 類別 | 必須驗證 | 判斷 |
|---|---|---|
| 本人接受 | 正確 D/E/H Auth Email 接受自己邀請；不同 Email、未驗證 Email、過期邀請被拒絕 | PASS / FAIL |
| Team A 學生 D | 只可讀 QA A Shared Math，不可見 A Private Science／B Shared English | PASS / FAIL |
| Team A 學生 E | 只可讀 QA A Private Science，不可見 A Shared Math／B Shared English | PASS / FAIL |
| Team B 學生 H | 只可讀 QA B Shared English，不可見 A Shared／Private | PASS / FAIL |
| 正向 + 負向 | 使用至少八個獨立**隔離 GoTrue 真 JWT**驗證合法讀自己的課程及跨學生／跨 Team 被拒 | PASS / FAIL |
| 解除連結 | 解除後，同一 JWT 重新請求不可讀（不能等新登入才失效） | PASS / FAIL |
| 財務界線 | D/E/H 對 Billing／Payment／Refund/Private Fees RPC 均拒絕，學生 API 不回傳任何金額 | PASS / FAIL |
| 既有角色 | A/B/C/F/G 既有專案、課程與 manager-only 帳務不退化；V4 student/parent 仍正常 | PASS / FAIL |
| GUI | Codex 真實登入三個學生，手機／桌面、帳號切換、cache 清除、遮罩證據 | PASS / FAIL |

任何只有 UI 隱藏而未測後端查詢的證據不得標記資料隔離 PASS；任何只有隔離環境成功的結果不得聲稱正式站已完成。

## 6. Migration／安全發布門檻

1. **先核對當前 Main＝62 Migration 與既有 Draft PR #77/#82 的 Migration 63 依賴**。新學生連結 DDL 必須使用不衝突的版本、在一次性隔離環境重播 62 → 63 → 其後新增的 Migration，驗證 rollback / 安全回復。不得將本 RFC 當成 Migration 63 的自動授權。
2. 在獨立 Branch／Draft PR 開發，不直接改 `main`、Production RLS／Auth／Team 或費用。將 DB 函式／RLS 契約、Node/Postgres 合成 JWT/Chromium、負面繞權案例一起提交。
3. 上線前需具體的備份還原證據、各表/欄的存取控制、安全審查、可稽核的取消連結；正式 Migration 和 Main／Vercel 分別經當輪安全發布 Gate。
4. 經授權發布後，**只用 A/F 真正 manager 發送 QA D/E/H 專屬邀請**，並由 Codex 用 D/E/H 合法個別登入接受，不能用管理 SQL 偽造 `auth.users` 或繞過邀請驗證。

## 7. 現在不做的事

- 不在 Production 建立學生 Auth Link／直接插入管理員授權。
- 不修改、取消、沖銷既有三筆 QA 費用或清除不可逆的帳務／學生席次 Ledger。
- 不啟用正式收款、退款、銀行交易或更動實際學生個資。
- 不擅自套 Migration 63，也不擅自合併此設計 PR。
- 不將本機 QA Email、密碼、Auth UID、JWT 或截圖放進 Repo / Linear。
