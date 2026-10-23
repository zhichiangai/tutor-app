# 好好上課 V4.0.0-dev.1 — 雙向連結、QR Code、Google Apps Script 通知

**狀態：僅 GitHub 開發分支，未合併 main；SQL、Edge、GAS 均未部署。**

## 已提交的 V4 程式

- v2/v4-connections.js：家長主動申請老師、老師／家長的 QR、分享連結、核准、拒絕、撤回、解除連結。
- v2/app.js：與現有登入／學生管理流程接線；Google 登入回跳時保留邀請連結。
- v2/index.html、v2/style.css：在現有學生管理頁增加邀請區塊，不增加手機底部導覽數量。
- supabase/migrations/20261023090000_v4_bidirectional_invites_gas.sql：**只建立程式碼草稿**，不可直接套用正式 DB，請 Codex 在 staging 以 CLI 正式產生 migration 並審核。
- supabase/functions/v4-gas-bridge/index.ts：只供後端 GAS 讀取待寄通知，須由 Edge secrets 保護。
- integrations/google-apps-script/v4-notifications/Code.gs：GmailApp 寄送、寄件別名檢查、配額檢查、五分鐘排程。
- tests/v40-connections-gas-regression.mjs：靜態安全／結構檢查，不代表真實 JWT 或 Email 已驗收。

## 流程

- 老師選擇自己管理的學生，產生短效 QR（10 分鐘）或分享連結（7 天）。家長登入並送出後，老師還要確認對方才能連結。
- 家長可輸入老師 Email 和孩子稱呼，提出申請。對方核准並選擇所管理的學生後，才取得該學生的資料權限。
- 家長也可產生 QR。老師掃描後選擇自己的學生，家長確認後才完成。
- 申請可撤回、婉拒。老師保留既有 V3 邀請方式；家長也可解除自己的關聯。原學生、課程、付款歷史不可刪除。
- QR 只包含隨機、有期限、一次性 token；任何 token 都不等於已完成授權。

## Codex 未完成工作（一定先在隔離測試環境）

1. 建立 Supabase staging，設定 Preview 使用專屬 URL 與 publishable key；目前 V3 前端寫死正式 Supabase URL，**未修改此項前禁止在 Preview 用真實資料寫入測試**。
2. 用 Supabase CLI 建立新 migration，審查目前 SQL 草稿。驗證 SECURITY DEFINER、auth.uid()、RLS、無跨教師／跨學生讀取、已付款課程不變、過期及重複邀請、併發掃碼、失效通知。必須在 staging 實際執行 SQL 測試後再談 Production。
3. Workspace 建立或確認寄件別名 tutor-notify@rapid4grad.com；此地址尚未驗證可發信。不得修改 RAPID4GRAD 另一產品的寄件者。
4. GAS 與 Edge 設定：Supabase Edge Secrets 放 V4_GAS_BRIDGE_SECRET，service role 只能在伺服器；GAS Script Properties 放 V4_BRIDGE_URL、V4_BRIDGE_SECRET、V4_FROM_EMAIL。嚴禁記錄或提交秘密。
5. 部署 staging Edge bridge 前確認 JWT 驗證策略：若用自訂金鑰，務必驗證沒有金鑰時回 401，且不可從瀏覽器直接呼叫。對 GAS 設五分鐘排程前先單次測試。
6. 實際寄信給測試老師與家長，確認寄件地址、名稱、收件、拒絕、解除、額度不足、GAS 失敗、重試及去重。Gmail 接受信件後若 ACK 失敗，仍可能重寄，需紀錄告警。
7. 使用真實 Google 測試帳號與手機 Safari、Chrome 測 QR、登入回跳、核准、資料隔離、取消、解除；執行 Node + DB JWT tests。
8. 保持 V3.5.9 正式網站、正式 Supabase、Vercel Production、現有 Workspace 設定不動；Production merge、migration、Email worker 啟用均須用戶明確授權。

**開發分支：feat/v4-bidirectional-invites-qr-gas-20261023。版本標示 V4.0.0-dev.1，尚非正式 V4.0。**
