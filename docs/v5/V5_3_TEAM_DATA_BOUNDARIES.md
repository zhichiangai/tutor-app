# V5.3 第一階段｜Team 資料歸屬與隔離

**狀態：Draft PR #53；只允許隔離 Supabase 測試，不得套用正式 Production。**

## 一、核心設計

V4 的 `public.workspaces.owner_id` 是老師個人資料所有權，V5.2 的 Team 治理暫時仍靠舊 workspace UUID 作為錨點。V5.3 引入穩定的 `v5_teams.id`，將新建 Team 資料改存於專用表。舊 workspace 僅作相容性 anchor，不能作為 Team 學生／課程的直接所有權判斷。

| 資料 | 儲存位置 | 主要權限 |
|---|---|---|
| V4 個人學生、課程、付款 | 原本 `students`、`lesson_records`、`payment_*` | 沿用 V4，**不搬移、不修改** |
| Team 身分 | `v5_teams` | 現任管理者、有效 roster 成員可查 |
| Team 專案 | `v5_team_projects.team_id` | 現任管理者或被指派的老師 |
| Team 學生 | `v5_team_students` | 管理者及目前被指派到該生專案的老師 |
| Team 專案入學紀錄 | `v5_team_enrollments` | 管理者及對應專案老師 |
| Team 課程 | `v5_team_lessons` | 管理者及對應專案老師 |
| Team 學生終身名額 | `tutor_private.v5_team_student_seat_ledger` | 僅資料庫觸發器管理，前端無直接權限 |

## 二、安全原則

- 只有 **Team 現任管理者**能建立 Team 學生及建立／解除入學關係。老師須正式加入 roster 並被指派專案，才可替該專案學生建立自己的 Team 課程。
- Team 課程保留實際授課者 `teacher_user_id`，不可由前端修改；老師退出後，歷史授課者仍保留，但其原 JWT 立刻失去 Team 課程讀取權。
- Team 專案與 Team 學生使用複合外鍵關聯。即使同一管理者負責兩個 Team，也不能把 Team A 的學生放進 Team B 專案。
- Team 的 100 名累計學生加上手動額外名額，改使用 Team 專屬私有帳本；歷史學生即使封存也不釋放名額。
- **沒有直接刪除 Team 學生／課程的瀏覽器權限**，避免破壞歷史歸屬。
- 未建立 Team 付款資料表。老師能看到課程並不代表有權讀取學費，**Team 帳務維持管理者專屬的後續設計方向**。
- 不使用 `auth.jwt().user_metadata` 當權限判斷依據。

## 三、隔離驗收

新增的本機 GoTrue JWT、PostgREST 與 PostgreSQL 測試涵蓋：

1. 原 V4 workspace 所有人退出 Team 後不能新增或讀取 Team 學生。
2. 不同 Team 不能互相加入專案與學生，複合外鍵必須拒絕。
3. 老師只加入 roster 時不能讀學生；指派特定專案後才可看該專案學生及課程。
4. 老師建立課程必須是自己的有效指派；移除老師後同一 JWT 撤權。
5. Team 學生封存後，不會刪除歷史課程或釋放累計名額。
6. V4 原 `students`、`lesson_records`、V5.1 個人學生名額帳本的筆數保持不變。
7. 每張新 public 表啟用 RLS；沒有開放 `anon` 直接資料存取。

## 四、後續 V5.3 功能與正式發布阻擋

此 PR 是**資料模型與後端權限第一階段**，不是 V5 完整商用版本。仍需完成 Team 實際課表 UI、個人資料安全遷移、管理員專屬跨老師帳務、家長跨專案帳務及付款分配、預收款、完整備份還原、真正隔離 Preview 登入與 GUI 驗收。

尤其舊 V5.1 的個人 `v5_my_plan` 與 `workspaces` 方案錨點仍有相容性關聯；正式發表前須做完整訂閱／Team 組織獨立方案模型，以免個人建立學生也消耗 Team 原方案配額。**此第一階段不能宣稱全面隔離完成或 Production GO。**

## 五、開發與發布順序

PR #51（V5.1）→ Draft PR #52（V5.2）→ Draft PR #53（V5.3 資料隔離第一階段）。

只有在隔離 Node、PostgreSQL、Chromium E2E 全部通過並另行核准後，才能考慮合併與 Migration。正式站 V4 維持不變。
