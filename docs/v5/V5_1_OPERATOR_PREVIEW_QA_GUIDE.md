# V5.1｜隔離 Preview 方案管理與 QA 名額清理

本文件適用於 PR #51。這不是正式站的營運後台，也不授權清除 Production 資料。

## 位置與開放條件

- 管理者介面：隔離 Preview 的 /v2/v5-admin.html
- 管理 API：同網域 /api/v5-admin
- Production API 固定回傳 HTTP 404。
- 只允許 Vercel Preview 網域、非正式 Supabase 專案、登入後的 UID 白名單操作者。
- 網頁只持有 Supabase publishable key；不持有 service-role key。
- 方案授權不代表扣款，V5.1 金流仍未啟用。

### Vercel Preview 環境變數

以下名稱僅供受控部署設定，不要提交實際金鑰：

| 名稱 | 用途 |
|---|---|
| V5_ADMIN_PREVIEW_ENABLED | 僅字串 true 啟用 |
| V5_ADMIN_OPERATOR_UIDS | 逗號分隔的管理者 Supabase Auth UUID 白名單 |
| V5_ADMIN_SERVICE_ROLE_KEY | **隔離 Preview 專案**的 service-role／secret key；不可設為公開變數 |
| V4_PREVIEW_SUPABASE_PROJECT_REF | 隔離專案 Ref，不能等於 Production |
| V4_PREVIEW_SUPABASE_URL | 必須與隔離專案 Ref 完全匹配 |
| V4_PREVIEW_SUPABASE_PUBLISHABLE_KEY | 對應 Preview 的公開金鑰 |

API 每次使用隔離 Preview 專案的 Auth /user 驗證存取 Token，依後端取得的 UID 判斷管理權限。不接受前端自行宣稱的操作者身分。正式使用者帳號不應被當作隔離測試寫入憑證。

## 一、手動方案授權

1. 管理者在隔離 Preview 使用授權帳號登入。
2. 開啟 /v2/v5-admin.html，讀取合成工作空間與目前名額。
3. 選擇 Free／Pro／Team，必要時設定額外學生名額。
4. 填入 10 至 500 字操作理由，輸入頁面顯示的完整確認文字。
5. 提交後重新查詢方案、累計學生及老師使用量。

後端使用 service-role-only RPC 寫入方案資料並記錄 tutor_private.v5_entitlement_grant_audit。一般匿名或登入使用者不能直接呼叫管理 RPC。

## 二、安全釋放 QA 名額

這個操作不刪除學生、課程、付款、家長連結、Auth 使用者或工作空間，只調整私有的 V5 累計名額帳本。僅當以下條件全部成立，名額才可以釋放：

1. 學生建立時（或 V5 導入時）標記 is_qa=true。
2. 該學生在指定工作空間的學生資料表已經不存在。
3. 管理者指定工作空間、目前精確可釋放數量和操作理由。
4. 輸入完整確認文字，資料庫交易中重新確認候選筆數未改變。

資料仍存在、不是 QA、筆數不一致或身分不符時整筆操作失敗。成功後留下 tutor_private.v5_qa_seat_release_audit。

這不是重置正式會員累計名額。歷史未標記 QA 的假資料，需要另外規劃受控的清理方式；不可讓使用者直接清空整個名額帳本。

## 三、驗收範圍

- Node 回歸：node --test tests/v5-admin-security-regression.mjs
- Node 全套：node --test tests/*.mjs
- 隔離 PostgreSQL 與 Chromium E2E：tests/e2e/v5-plan.spec.mjs
- 一般登入者不能讀取管理概覽、呼叫管理者 SQL RPC 或修改授權。
- 所有寫入均需要原始來源、有效 Auth 身分、UID 白名單、預期筆數與完整確認文字。
- 測試僅使用本機 GoTrue JWT 和合成帳號，正式資料寫入 0 筆。
- CI 完成之前 PR #51 維持 Draft，不合併 Main。

## 四、正式發布前的限制

正式營運仍須補足管理者權限交接、方案通知、付款對帳、備份與還原、OAuth 憑證事件及 V5 Migration 發布流程。Production 管理 API 預設不可用，後續若需要正式營運後台，必須另行設計及安全驗證。
