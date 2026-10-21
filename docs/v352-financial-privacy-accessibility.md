# V3.5.2 驗收修正：財務狀態、登入資料清除、窄螢幕星級

**狀態：獨立分支供審核；不得自動合併 main、部署或套用正式 Migration。**
基準 `main` Commit：`9528c045c11e53fd0b7676e294e47d40ae8006b1`（PR #21）。
正式環境仍是 V3.5.1。此分支不修改實際學生、課程、付款或 Auth 資料。

## High：舊式收款解除鎖定漏洞

問題：V2.5 原函式 `tutor_private.guard_paid_lesson()` 僅在財務欄位修改時檢查舊 `status`；無批次和付款申請的老師已收到課程可以先改成未付款，再改時數與總額。

**防護範圍：**

- `status='老師已收到'`、`'家長已付款'` 均為有價值的既有收款事實；一般 `UPDATE` 不准降低為未付款、任意換狀態，也不准在已保護狀態下修改日期、時數或計價。
- 維持正常「家長已付款 → 老師已收到」的前進狀態，並保留付款批次已確認金額檢查。
- `family_requests` 的 pending/approved 付款申請及 pending/confirmed 付款批次，即使 `status='未付款'`，仍不允許直接修改金額、日期、計費時數。
- 直接修改既有已收款日期被拒絕。一般教學回饋欄位（內容、專注度、心情、課後備註）不在計費鎖定之內，老師仍可補寫。
- 任何付款批次下的部分收款一律保留原有資料，不直接改動或批次清洗。

**受控的舊式收款撤銷（不影響有付款關聯的課程）：**

新函式 `public.reverse_legacy_lesson_receipt(lesson_id, expected_updated_at, reason)`：
只有登入的原課程老師、在課程狀態為舊式已收款且沒有任何付款批次項目、沒有 pending/approved 付款申請時才可呼叫。需要提交最新版 `updated_at` 及 10–500 字原因。

函式在同一個交易中，先將授權資訊寫入 `tutor_private.legacy_receipt_reversal_audit`，再清空舊收款日期並恢復未付款；更新觸發器只能消耗當次交易同一使用者的一次授權，且稽核資料由私有 schema 保存。無一般瀏覽器表格權限。

有付款申請或批次的課程**不能**使用此舊式撤銷 RPC，需先由原帳務流程對帳，防止不一致或重複入帳。這次不提供自由更改真實收款資料的 UI。

> 安全說明：新的受限 `SECURITY DEFINER` RPC 雖有嚴格的 `auth.uid()`、owner、版本、批次與稽核檢查，Supabase Security Advisor 仍可能新增一個 SECURITY DEFINER 警告。必須逐項審查，不能以停用稽核或放寬權限來消除警告。

**Migration（未套正式）：**
`supabase/migrations/20261022021000_v352_legacy_receipt_status_guard.sql`

## Medium：登出後舊學生資料殘留

新增 `clearUserSessionState()`，在登出、JWT/登入失效、Google 帳號 A→B 切換以及初始化失敗時，統一清除：

- `LIVE_FIELDS`、`studentPortal`、`sharedCourseHistory`。
- 目前選取課程、共用課表編輯草稿、帳務對帳草稿、課程表單、星級及老師偏好。
- `#student-portal-content` 等敏感 DOM 容器，並關閉仍開著的私有視窗。
- 未登入時 `renderStudentPortal()` 直接清空而不渲染既存學生紀錄。
- 透過 `authDataGeneration` 與帳號 ID 雙重判斷，防止 A 帳號過期的非同步資料載入完成後又寫入 B 帳號 UI。

刪除的是**客戶端已載入資料**，不刪伺服器學生或付款資料，也不會更動原本 Google 登入政策。

## Low：320px 星級可操作性

在 `@media (max-width:420px)` 將「專注度」與「學生心情」由雙欄改為上下單欄；每組使用固定五欄、44×44px 觸控目標，讓五顆星維持同一排並保留垂直捲動。仍須真實 iOS Safari 驗證。

## 測試與發布條件

- `node --test tests/*.mjs`：既有課表、Google 模式、學習與付款測試 + V3.5.2 新增登出/帳號切換、非同步舊資料、計費鎖、手機 CSS 回歸。
- SQL：先將 Migration 放入 `BEGIN`，建立獨立臨時 auth/學生/課程、付款申請與批次後測試，再 `ROLLBACK`；不套用正式 Migration。
- 真正 PostgreSQL `authenticated` 身分確認「先將已收到改未付款，再改時數／金額」被擋下，合法老師舊式撤銷可留稽核，家長無法撤銷、付款批次或申請受保護。
- 不碰 QA 課程 `58968187-17ff-4697-95e1-bc6d070aafdd`；保持 1.25 小時、單價 500、合計 625、專注 4／心情 5 與兩筆已記錄的 QA 收款。
- CI 綠燈與 SQL ROLLBACK 不等於真人瀏覽器驗收；尚待重新做 320px 觸控、登出 DOM 清空、A→B 獨立 Session、實際收款流程、全新老師建空間及 iOS Safari。
- PR 僅供審核，不在本次自動合併、部署或套用正式 migration。

## 額外留意

Supabase 原有四個 `SECURITY DEFINER` 警告應分別查誰可 EXECUTE，確定 RPC 嚴格驗證登入者／學生關聯；`Leaked Password Protection Disabled` 需先釐清是否使用密碼登入及方案支援再啟用，**不得擅自修改正式 Auth 設定**。
