# V4.0.0-dev.2 驗證與發布關卡（2026-10-23）

狀態：PARTIAL，Draft PR #30，禁止合併或發布 Production。
分支：`feat/v4-bidirectional-invites-qr-gas-20261023`。
接續基準：`6744e46e074c24c64a40d8940a744e90b07d0938`；首輪修正 `904e26773439970ec5fc2176112c5694c60ef70d`。

## 已完成與證據

| 項目 | 結果 | 範圍 |
| --- | --- | --- |
| Node 原基準 | PASS | 本機重新執行 144／0／0 |
| Node dev.2 | PASS | 首輪本機與 CI 156／0／0；末輪新增失效邀請復原測試，本機 157／0／0，最終 CI 以 PR 最新 SHA 為準 |
| PostgreSQL 17 隔離 contract | PASS | [首輪 CI](https://github.com/zhichiangai/tutor-app/actions/runs/39922107121) 34 個斷言；最終另補解除後狀態斷言，結果以 PR 最新 SHA 為準 |
| SQL 草稿 | PARTIAL | 修正語法、NULL、SHA-256、RLS、限流、資源歸屬、狀態與佇列；未由 CLI 正式整理、未套任何 Supabase |
| GAS 專案 | PASS | 已建立獨立「好好上課通知 — V4 隔離測試」，已儲存 dev.2 worker；原專案未修改 |
| GAS 實際檢查 | PASS | 首次授權後成功執行只讀檢查；不是模擬 Workspace 回應 |
| 寄件別名 | BLOCKED | GAS 回報指定 tutor-notify@rapid4grad.com 尚不可用，可用別名數 1；未擅自替換寄件者 |
| 寄送額度 | PASS | 當次 GAS 回報 remainingRecipients=1500；這是當下 Apps Script 額度，不能推廣成固定保證 |
| 寄信／排程 | NOT TESTED／未啟用 | 未寄出任何測試信；觸發條件畫面確認 0 筆；缺 staging、別名及獲准 QA 收件者 |
| 前端隔離 | PASS（程式與 Node） | dev 前端不再預設 Production DB；未設定隔離專案即停止，不只停用 V4 RPC |
| QR／分享與相機替代 | PARTIAL | 已有產生、貼連結、原生分享、相機不支援／拒絕替代；尚未真實手機掃碼驗收 |
| 真實 JWT／OAuth／手機 | NOT TESTED | 尚無獨立 Supabase Auth／真實測試 Session，不能拿 DB 模擬權限替代 |
| V3.5.9 保護 | PASS（變更邊界） | 本機 main 仍在 ce74e6c…，未改正式程式、資料、部署及另一產品 Email；不代表本次重跑正式瀏覽器所有功能 |

## PostgreSQL 合成測試覆蓋

匿名／一般登入角色不能讀原始申請或管理郵件；家長發起、老師核准；拒絕他人教師與他人學生；重複核准與一次性 Token；雙向 QR 對應 RPC；多家長一學生、一家長多教師；拒絕、撤回、過期；解除關聯保留合成學生／已付款課程快照；未知 Email 探測限流；ACK 租約及人工重試；通知入列失敗不回滾合法連結。

此環境是 GitHub Actions 的拋棄式 PostgreSQL，只有合成 `.test` 資料與最小契約 schema。不是完整 Supabase staging，不測真實 Google JWT、Data API、OAuth、實際舊版 RLS、網路同步或相機，未驗證所有併發情境。fixture 不能套到正式環境。

## 實際阻塞

- Supabase Branching 回報需 Pro 或以上；沒有建立分支、購買或升級，也沒有拿另一產品的資料庫測試。
- 本機 Supabase CLI 子程序被 SIGKILL；Docker API 權限不足；HTTP server bind 回報 Operation not permitted。沒有繞過 sandbox 或系統保護。
- Workspace 管理入口要求重新輸入密碼確認本人；由使用者自行完成。不替使用者輸入密碼、不變更管理員設定。
- GmailApp 未提供指定寄件別名；後續需由管理員確認現有付費帳號的替代 Email，再確認 Gmail 以此地址寄送。不得改 DNS、買新使用者或動另一品牌。

## 發布前仍必須完成

1. 取得真正隔離 Supabase，CLI 正式整理 migration；核對完整 V3 schema、RLS、grants、trigger 與 FK 相容性。
2. 設定 staging 公開前端 config、Auth 回跳與 staging Edge。測無 secret 401、一般角色不能讀通知佇列；不把任何私鑰放前端。
3. 用真實 QA Google JWT 完成跨教師／跨學生／解除後權限驗收及已付款資料保護。
4. 在 iPhone Safari／Chrome 完成雙向 QR、失效 Token、OAuth 回跳、相機權限與分享；完整三角色及跨裝置回歸。
5. 別名就緒、明確指定 QA 收件者後，才能單次測 GAS 寄信、寄件地址／名稱、失敗及 ACK；通過後才安裝五分鐘排程。
6. 實際 staging 寄信前，用僅 service_role 可呼叫的 `v4_mail_set_app_url` 設定已核對的 staging 根網址；未設定時通知會移除可點擊入口，不導回正式站。
7. 保留 Draft；完成以上證據後才向使用者申請正式發布。不得以本次 CI PASS 宣稱 V4 已全面完成。
