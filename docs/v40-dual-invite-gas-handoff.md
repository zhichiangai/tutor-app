# 好好上課 V4.0.0-dev.2 — 雙向連結、QR Code、Google Apps Script 通知

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

## V4.0.0-dev.2 接續修正（2026-10-23）

保留上方 dev.1 歷史。此輪仍為 Draft，不可發布 Production。

- 修正 SQL `v4_cancel_connection_request` 的 dollar quote 語法、NULL 驗證、撤回者限制；一次性 token 改存 SHA-256 摘要，私有新表啟用 RLS。
- Email／QR 操作新增序列化限流與配對鎖，未知 Email 的通用成功回應仍計入頻率。核准、拒絕、撤回、重複／過期處理需經隔離 DB 驗證。
- 通知入列失敗僅留下無敏感資料的告警，不回滾合法連結。租約逾時改標 `uncertain`，不自動重寄；ACK 帶 lease token，受控人工重試僅 service_role 可呼叫且不重置次數。
- GAS 加 Script Lock、持久 ACK 紀錄、嚴格寄件者、隔離專案及 QA 收件者白名單；未啟用設定時不 claim、不寄信。寄送結果不明需人工比對 Gmail，不能承諾 exactly-once。
- `inspectV4MailSettings` 不需要 Bridge secrets，可先以 GAS 實際查 alias 是否可用及當日剩餘收件者額度。需由使用者親自完成首次 Gmail 授權；不能假定 Workspace 方案對應固定額度。
- V4 前端移除正式 Supabase 預設連線，改讀 `v2/v4-config.js`；未核對獨立 staging 時保持空白／關閉。此檔僅可放公開 publishable key，不能放 Service Role。
- 修正根路徑缺少 `v4-connections.js` rewrite；補掃描入口、手動貼連結、原生分享與相機拒絕／不支援替代；同頁標題與按鈕延用既有導覽。
- 加入 GAS／Edge 行為測試，以及 GitHub Actions 拋棄式 PostgreSQL contract 測試。合成 fixture 只涵蓋 V4 依賴契約，不代表正式 Supabase 全 schema 或真實 Google JWT 已驗收。

### 安全設定順序

1. 先取得使用者可用的獨立 Supabase staging（不得使用正式 Ref `vctisuglfoxyuwlvyjee`，也不得借用另一產品）。本輪 Branching API 回報需 Pro，未升級或購買；本機 CLI 被 SIGKILL、Docker API 無權限，因此尚未由 CLI 正式整理 migration。
2. 在可用環境執行 `supabase --version`、`supabase migration new --help`，用 CLI 正式產生 staging migration，再審查既有草稿並執行 DB／JWT 驗收。不要把此草稿已存在誤認成 CLI 產生或已套用。
3. `v2/v4-config.js` 填隔離專案的 `projectRef`、`url`、`publishableKey`，確認後才設 `isolated:true`。Google OAuth 需使用 staging 的回跳設定，保留 `v4invite`，不可改 Production Auth。
4. staging Edge secrets：`V4_GAS_BRIDGE_SECRET`（至少 32 字元高熵隨機值）、`V4_STAGING_PROJECT_REF`。Service Role 僅伺服器環境。Bridge 拒絕 Production endpoint 與瀏覽器 Origin。
5. Edge gateway JWT 策略須明確設定：GAS 只傳 shared secret，若停用 gateway JWT 必須保留 handler 的 secret 驗證並實測無金鑰 401；這不是公開寄信 API。不部署 Production Edge。
6. 使用獨立「好好上課通知」GAS 專案，貼入 `Code.gs` 及提供的 manifest。GmailApp 需要 Gmail 權限，首次 OAuth 由使用者親自審查。不是 GAS Web App，不部署任何 doGet／doPost。
7. 先執行 `inspectV4MailSettings`。若 `senderAvailable:false`，到 Workspace 管理員使用者的「替代電子郵件」確認既有付費帳號別名，再到 Gmail「帳戶／以這個地址寄送」設定；不要購買新帳號、替換寄件者或更動 DNS。管理員與新增別名操作由使用者確認。
8. Script Properties 填 `V4_BRIDGE_URL`、`V4_BRIDGE_SECRET`、`V4_FROM_EMAIL=tutor-notify@rapid4grad.com`、`V4_STAGING_PROJECT_REF`、`V4_TEST_RECIPIENTS`。保持 `V4_MAIL_ENABLED` 關閉，直到明確核准的 QA 收件者與單次寄信測試就緒。
9. 單次測試前暫設 `V4_MAIL_ENABLED=true`，執行 `processV4MailQueue`；核對收件、寄件者名稱／地址、佇列 ACK。失敗時關閉啟用設定，不反覆重寄。通過後才執行 `installV4MailTrigger`，其五分鐘排程會拒絕重複建立。
10. ACK 失敗先檢查 GAS `V4_DELIVERY_*` journal；有成功寄送紀錄只補 ACK。伺服器 `uncertain` 訊息必須比對 Gmail、確認沒有送達後，管理員才能呼叫 `v4_mail_retry(id,true)`。超過三次不自動清零；不得盲目刪 journal。

### 目前驗收界線

Node 行為測試與 CI PostgreSQL contract 的結果以最新 CI 為準。真實一般使用者 JWT、iPhone Safari／Chrome、完整跨裝置 OAuth／掃碼、GAS 真實寄信仍未通過；獨立 GAS 專案已建立並存入 worker，首次只讀檢查已成功：指定別名不可用，當下剩餘收件者額度 1500；管理入口需使用者重新驗證密碼。正式 V3.5.9、正式資料庫及另一產品通知設定未修改。

完整驗證與限制見 [dev.2 驗證報告](v40-dev2-validation.md)。解除關聯會同步將新申請歷史標為已解除；失效 Token 不再隱藏手動輸入復原入口。

通知佇列新增 service-only `v4_mail_set_app_url(staging根網址)`；未設定時移除正式站入口，避免 QA 郵件導回正式環境。一般使用者不可更改寄信入口。
