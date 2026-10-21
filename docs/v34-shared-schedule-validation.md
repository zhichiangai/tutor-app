# V3.4 三方共同排課：一致性、安全與驗收

## 版本與範圍

- 正式網址：https://tutor.rapid4grad.com/
- 前端：Vercel，`v2/`；後端：Supabase `tutor-app`，Project `vctisuglfoxyuwlvyjee`。
- GitHub 原始碼：`zhichiangai/tutor-app`，V3.4 變更須經 PR、CI、Migration 審核。
- 老師、家長、學生使用相同資料表；`shared_course_action` 對每次操作重新查學生關聯。
- **三個不同 Google 帳號的實際跨帳號、手機瀏覽器驗收尚未用本次 CI 取代**。

## 本次修正

1. **樂觀鎖**：所有家庭操作既有單堂課、整組規則、固定課表單堂例外都強制提交 `expected_updated_at`；資料庫內以鎖住的最新時間比較，缺少／過期直接拒絕。老師直寫表格的 UPDATE 也會更新規則時間戳。單堂例外變更會推進母規則時間戳。
2. **撞期**：私有 helper `v34_has_conflict` 查單堂、原定虛擬課與已改期課；`v34_assert_schedule_available` 查既有單堂及未來無限週／雙週規則。對同一教師的多學生共享操作使用交易層 advisory lock；也在老師原有表格直寫流程加入 BEFORE INSERT/UPDATE guard。
3. **雙週日期**：固定規則需吻合 ISO 星期與從規則開始週推導的雙週相位。不存在的週不可直接取消或改期；老師直接編輯 exception 也須符合頻率。
4. **取消來源**：保留舊版 `leave_source` 的 student／teacher 請假方語意；新增稽核欄位 `actor_role`（操作者老師／家長／學生）、`cancellation_source`（哪一方取消）、`cancellation_reason`（原因，可空）。家長替學生請假是 guardian 操作者、student 來源，不是系統錯誤。僅老師可指定 teacher-side cancel。
5. **帳務與歷史**：保留原有付費時段保護，取消一整組固定課表只會停止**未來**剩餘排課，不回頭清除已完成歷史。修改固定規則導致舊規則停用的紀錄不誤標成學生請假。
6. **科目費率**：家長／學生仍不能指定鐘點費。新增課程採老師對學生設定的預設費率；編輯既有課程沿用既有費率。更換科目**不會自動換算不同科目的單價**；若老師按科目計價，必須由老師進入原有帳務流程確認，現階段不宣稱已完成多科目價目表。
7. **RLS**：合併 `student_links` 完全等價的重複 authenticated SELECT policy，保留原有的 self/teacher 存取範圍。

## 風險與限制

- 這次的撞期限制**刻意比 V3.3 原有「警告後可照常新增」嚴格**：有時間衝突會拒絕，而非讓使用者繞過。避免同一老師被排進兩個學生課程。
- 週／雙週規則使用 14 天共同週期推導未來重疊；即使未來某幾堂個別取消，也不允許建立長期會撞期的整組規則。請先停止或調整舊規則。
- `v34_guard_lesson_write`、`v34_guard_rule_write`、`v34_guard_exception_write` 同時保護老師的舊版直接寫入流程；部署前應特別測試老師原有新增、改期、修改上課時數及停課。
- Supabase Auth 的「Leaked Password Protection」無法藉由 SQL Migration 開啟；須管理員確認是否使用密碼登入及方案。已登入使用者的四個必要 SECURITY DEFINER RPC 警告可能繼續存在。
- 系統目前不自動即時推播。重新載入會同步最新版本；兩人同時編輯舊資料時應拒絕後儲存者並提示重新整理。
- 這次不自動改寫過去或已付款的歷史課程，不清理既有真實資料，不將 production `service_role` 金鑰交給瀏覽器或測試程式。

## 本機與雲端測試

- `node --test tests/*.mjs`，確認所有舊版及 V3.4 regression 通過。
- Supabase Migration：`20261021170000_v34_shared_integrity.sql`，套用後查 `pg_proc`、觸發器及 Policy；用暫時建立的授權測試學生、課程做完整 **BEGIN ... ROLLBACK** 交易。
- 測試情境：合法新增單堂、同時段撞期拒絕、雙週隔週無效日拒絕、教師跨學生撞期拒絕、過期版本拒絕、家長取消的操作者與來源區分、已付款資料不可修改、非連結帳號拒絕操作。
- **真人瀏覽器 E2E**：三個不同 Google 帳號，老師先設測試學生並邀請家長和學生；雙方互相修改、重整課表、同時修改後檢查衝突、解除邀請立刻失權；Chrome 桌面、iPhone Safari 或 Playwright 手機 viewport 測試。
- 後台密碼政策與跨帳號驗收未完成時，不應把「CI 綠燈」等同完全正式驗收。

## 驗收狀態

本文件用來記錄設計與測試清單；GitHub PR 合併與 Vercel 部署、Supabase Migration、真人 E2E 均應個別回報結果，不應預先標示完成。
