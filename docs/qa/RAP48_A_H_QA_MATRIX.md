# RAP-48｜A～H 固定 QA 身分矩陣（公開規格，不含憑證）

> 本文件只記錄**預期角色及授權關係**，不得放入實際 Email、密碼、Auth User ID、JWT、Cookie 或學生資料。
> 任何「已建立帳號／已驗收」狀態都必須由真正的 Auth 與 GUI 證據確認，**不得根據本矩陣推定完成**。

## A～H 規格（固定代碼）

| 代碼 | 固定 QA 名稱 | 身分 | Team | 預期權限 |
|---|---|---|---|---|
| A | QA-RAP48-A-MANAGER | 管理者／老師 | Team A | 所有 A 專案、成員管理、A 帳務 |
| B | QA-RAP48-B-TEACHER | 一般老師 | Team A | 僅 A 共用專案；不得看 A 私人、B Team 帳務 |
| C | QA-RAP48-C-UNASSIGNED | 一般老師 | Team A | Team 成員但未指派專案；不得看 A 專案詳細或帳務 |
| D | QA-RAP48-D-STUDENT1 | 學生 1 | Team A | 僅本人的學習／課程資料，無任何費用欄位 |
| E | QA-RAP48-E-STUDENT2 | 學生 2 | Team A | 僅本人的學習／課程資料，與 D 隔離 |
| F | QA-RAP48-F-MANAGER | 管理者／老師 | Team B | 所有 B 專案、B 成員及 B 帳務；不得看 A |
| G | QA-RAP48-G-TEACHER | 一般老師 | Team B | 僅 B 已指派專案；不得看 A 或 B 管理帳務 |
| H | QA-RAP48-H-STUDENT | 學生 | Team B | 僅本人的學習／課程資料；不得看 A、無費用 |

每組都必須是**獨立 Supabase Auth User ID + 有效獨立密碼**，不可拿同一帳號僅切換 UI 模式冒充不同人。Team A/B 為兩個不同的合法 Team，且要有足夠的共享／私人專案與最小測試資料（保留撤銷與清理路徑）。

**資料模型缺口**：目前 `v5_team_students` 存的是 Team 學生資料，不包含 Auth user ID 對應；V4 `student_links` 為另一路徑。不可只把 D/E/H 寫進 Team 學生表就宣稱「學生已登入 Team」或「跨 Team 學生 RLS PASS」。在正式驗收前先證明其合法連結路徑；不足部分列為 BLOCKED/需功能需求，不偷改 RLS 或登入角色。

## 本機私有的唯一帳號紀錄（由 Codex 在 Mac 核對）

`/Users/fengfeng/家教小網站/TEST_ACCOUNT_ROLES.md`（本機而非 GitHub）。
本 Repo 的 `.gitignore` 明確排除該檔。Codex 於本機實際讀取 `AGENTS.md`、`note/ai-handover/00_START_HERE.md`、`06_QA_AND_EVIDENCE.md` 與既存帳號文件，先查看 `git status`，局部追加 A～H 行，不覆蓋舊資訊；設為僅本機擁有人可讀（0600）。每行記錄固定代碼、實際 Email、實際臨時密碼、角色、Team、Auth UID（僅本機）、登入確認狀態、建立／到期日期、測試項、最後確認時間和清理狀態。密碼不得回貼聊天、PR、CI、Linear 或截圖。

## 最小驗收順序

1. ChatGPT 維護雙軌登入及自動測試；Google OAuth、清除登入狀態與資料隔離不得回歸。
2. 經**正式 Production Auth／Team 寫入的當次核准與備份／清理 Gate**，在受控管理介面建立 A～H Auth 使用者及兩個獨立 Team；優先使用使用者可控 Email 別名，但須先驗證 Supabase 為不同 UID；不提供公開自助註冊、不輸出管理金鑰。
3. Team A 至少兩個專案（共用、私人），Team B 至少一個專案。A/B/C/F/G 的指派符合上表；學生 D/E/H 的合法登入連結要獨立審查。
4. Codex 以 IAB 每次完全登出、獨立登入，完成 1440×844、390×844 的 Projects／Learning／Billing；跨 Team 和跨學生**未授權查詢應空集合或權限拒絕**。截圖先遮罩個資。
5. 跨 Team JWT/RLS 需後端合法不同身分的 SELECT/RPC 證據，不可只憑按鈕隱藏；嚴禁對正式學生／付款資料寫入。
6. 只要任一帳號未真正建立、學生連結未驗證或正式 GUI 未實測，整體維持 PARTIAL/BLOCKED；不重跑已核實的 RAP-12 102 張合成截圖。

## 發布界線

本 PR 只新增 Email/密碼登入功能與 QA 文件／測試，**不**建立正式帳號、不授權 Team、不套用 Migration 63、不合併 Main／觸發 Production 部署。正式開通與清理需要獨立授權、可復原計畫及實際工具支援。
