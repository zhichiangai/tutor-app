# V5.2｜Team 團隊與多專案：第一階段

## 延用 V4 的設計

一個老師仍只擁有一個 V4 workspace；升級 Team 時是把原 workspace 的 V5 方案標記為 Team，不另外建立第二個 workspace，以避免撞上 V4 owner_id 唯一限制及既有 myWorkspace() 使用方式。

Team 名額沿用 PR #51：100 名累計學生、10 名現行老師（含擁有人）；V5.1 觸發器是最終強制來源。

## 表格與角色

| 表格 | 用途 | 存取限制 |
|---|---|---|
| public.v5_team_projects | 專案名稱、狀態、工作空間 | Team 擁有人可建立、管理；被指派的成員才可讀取 |
| public.v5_team_project_members | 專案與已加入 Team 的老師對應 | Team 擁有人可指派與解除；老師只能看自己的分配 |
| public.v5_team_invitations | 電子郵件邀請及 pending/accepted/declined/cancelled | Team 擁有人與收件者可讀；只有管理者建立，只有本人驗證後接受 |
| public.workspace_members (既有) | 已確認的 Team 現行老師成員 | Owner 可看與撤銷老師；老師只能查看自身成員關係 |

## 邀請生命週期

1. 擁有人在 Team 方案建立待處理邀請，填入受邀者電子郵件；尚未取得任何 Team 權限。
2. 受邀者登入 Google，且 email 必須已由 Auth 驗證；RPC 將目前 auth.users.email 與邀請比對，不能由前端偽造身分。
3. 接受後，RPC 才插入 workspace_members 教師成員；V5.1 的老師 10 人上限仍是最後資料庫 Gate。
4. 老師還需被 owner 指派特定專案，才能讀取其 Team 專案名稱／狀態。
5. Owner 移除 workspace_members 的教師列，專案成員 FK 連動刪除；使用相同未過期 JWT 也不再具有專案讀取權。

## V4 與 V5.3 界線

本階段**不修改** V4 students、lesson_records、payment_batches、學生與家長關係的 RLS 或寫入 API。V5.2 的專案中目前只保存專案 metadata 與老師指派，不包含學生與收款明細。日後跨老師課表、帳務、家長檢視及預收款將由 V5.3 專門加上授權資料模型與測試。不可因加入 Team 就讓所有老師讀取其他老師的全部學生資料。

## 隔離驗收

- 只能在已確認的 localhost 合成 Supabase 測試；Production 不進行 Team 增刪操作。
- Free 方案建立專案必須被拒絕，升級 Team 才可建立。
- 非擁有人不能建立 Team 專案、邀請別人或自行分配專案。
- 只有受邀且郵件身分吻合的使用者可以接受邀請；一筆邀請不可重複使用。
- 僅接受邀請不能直接看到專案；受指派後只能看到被指派的專案。
- 撤銷老師成員後，同一 JWT 必須立即失去專案存取權；專案本身及歷史資料保留。

## 發布管理

本項變更為 Draft PR #52，Base 是 PR #51 的開發分支，不直接合併 Main。先讓隔離 PostgreSQL、JWT、Chromium 及 V3 regression 通過，再完善 Team 使用者介面。V5.1 的真正隔離 Vercel Preview 管理後台仍需要獨立 Supabase 與環境變數設定，READY 並不是 GUI 驗收。

## V5.2 第二階段：教師退出及成員移除稽核

老師已接受邀請並成為 Team 成員後，得使用 `v5_leave_team(p_workspace_id)` 主動退出：
- 後端再次確認是有效 Team、本人為 teacher 成員，且不是 Team owner。
- 刪除 Team membership，透過外鍵連動取消全部專案指派；原 Team 專案及歷史紀錄保留。
- 使用原 JWT 立即失去原 Team 專案讀取權；個人工作空間與原有資料不變。
- 留下私有 `v5_team_membership_audit` 的 `teacher_left` 紀錄。

管理者移除老師改用 `v5_remove_team_teacher(p_workspace_id,p_user_id)`：
- 僅 Team owner 可執行，不允許移除本人；記錄 `teacher_removed`。
- 禁止使用一般 REST `DELETE workspace_members` 繞過稽核。
- 刪除成員後名額釋放；歷史專案 metadata 不刪除。

**管理者不得直接退出 Team。** 已確認的產品規則 A 是：管理權必須先轉讓給目前仍在 Team 的老師、對方接受，後端單一交易完成權限交接，原管理者轉為普通老師後才能退出；Team 所有資料及 ID 均保留。V5.2 現階段**沒有**實作管理權轉讓。因 V4 的 `workspaces.owner_id` 同時涉及老師個人空間和舊資料 RLS，不能直接修改它達到 Team 轉讓，必須先將 Team 治理與 V4 個人老師所有權分離，再實作轉讓交易和權限驗收。

另外，既有規則 A 要求 Team 帳務只有管理者可查看；V5.2 不變更 V4 財務資料授權。跨老師課表與財務、歷史授課者歸屬及權限轉移列入 V5.3。

## V5.2 第三階段：Team 管理權轉讓（雙向確認）

**個人與 Team 分離：** V4 `public.workspaces.owner_id` 永遠維持原家教老師，不因轉讓 Team 管理權而更新。V5 引入：
- `v5_team_governance`：每個 Team 的現任管理者和世代版本。
- `v5_team_roster`：Team 活躍老師名單，與 V4 `workspace_members` 不同。Team 老師 10 人限制以 roster 計算；V4 個人 owner 留存不佔已退出 Team 名額。
- `v5_team_manager_transfers`：不可由使用者直接編輯的待確認、接受、婉拒及取消紀錄。
- `tutor_private.v5_team_governance_audit`：每次提出和處理結果的安全稽核。

**流程：** 現任管理者以 `v5_propose_team_manager(workspace,target)` 指定已加入 Team 且電子郵件已確認的老師。此時新舊權限不變；接任者必須登入本人帳號，以 `v5_respond_team_manager(transfer_id,true)` 才正式接任。拒絕或原管理者取消均維持原狀。交易中鎖定 Team 與轉讓紀錄，禁止重複接受和非本人確認；每次只允許一件待確認轉讓。

**轉讓完成：** 新管理者接手 Team 專案、老師指派及邀請管理；舊管理者仍在 roster，已不具有管理權，可用 `v5_leave_team` 自行退出。舊管理者的 V4 個人 owner membership、lesson_records、帳務及其他個人資料維持不變；已建立的 Team 專案與存續歷史不刪除。

**權限界線：** Team 管理者僅取得 V5 Team metadata 管理權，絕不自動取得 V4 原老師課程、帳務或學生的讀取權。跨老師課表和帳務仍屬 V5.3，需另外設計資料歸屬與 RLS。

**後台顯示：** Team 設定卡獨立呼叫 `v5_my_managed_teams`，不能用 `getOwnWorkspace()` 或 `v5_my_plan()` 判定誰是 Team 管理者。普通老師能接受或拒絕管理權轉讓；已退出 Team 的原管理者在 UI 不應再看見原 Team 資料。

**隔離驗收必須確認：** 未被邀請老師不可接任、錯帳號不能接受、被拒與被取消不能生效、管理者在接任人接受前不能退出、接受後原管理者失去管理權、同一 JWT 即時撤權、舊個人 workspace 的 owner_id 完全不變、Team 專案歷史保留、審計完整。

## V5.3 必須解決的資料歸屬界線（正式營運阻擋）

V5.2 雖已將 **Team 管理者身分** 與 V4 `workspaces.owner_id` 分離，但 Team 專案仍以原始 V4 workspace UUID 作為共同識別。因此，這只是 **治理權與專案 metadata 的隔離**，不是完整的課程／學生／帳務資料模型分割。

特別是：Team 創立者轉讓管理權並退出 roster 後，仍保有自己 V4 個人 workspace 的課程存取與新增權限。若該 workspace 同時對應 Team 方案，舊老師新增 V4 學生仍可能影響 Team 累計名額。這部分**尚未隔離**，不可宣稱 Team 資料歸屬已可供商業正式營運。

V5.3 開始前需決定完整的 Team 穩定實體（與個人 workspace 分離）、課程的專案歸屬、學生歷史累計名額歸屬、個人與 Team 資料搬遷規則、家長可見範圍，以及管理者退出後的帳務權限；並在隔離環境證明轉讓後舊創立者對 Team 課程與新學生不再具有個人 owner 的隱含權限。V5.2 Draft 不能因此直接視為 Production GO。
