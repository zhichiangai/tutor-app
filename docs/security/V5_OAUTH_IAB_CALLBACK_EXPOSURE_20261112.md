# 好好上課｜OAuth 回跳憑證出現在 Codex IAB 輸出（2026-11-12）

> **分級：SEC-01 / P0 安全驗收阻擋，非已證實的遠端攻擊。** 不附回跳網址、Access Token、Refresh Token、OAuth Code、Google 帳號、個資、Session ID 或截圖。此文件不宣告已撤銷使用者工作階段。

## 事件與證據界線

- V5.7 Production Alpha：Main `3c1136894af5858c03dceb80865243e260679b4e`，正式站 `tutor.rapid4grad.com`。
- Codex 回報：以老師 QA 帳號進行 Google OAuth 登入，IAB 工具在回跳時輸出含憑證的網址；已登出並確認網站登入遮罩。沒有把該網址或包含私人資料的畫面貼入交接。
- 已驗證的 Main 原碼：`v2/app.js` 使用 Supabase JS `createClient`、`detectSessionInUrl:true`，但未顯式設定 `flowType:'pkce'`；原 `scrubOAuthCallback()` 直到帳號與課程載入完成才執行。
- 這不表示 Google 密碼已外洩；但帶有 Supabase Bearer Token 的回跳輸出應依憑證暴露事件處理。**從截圖／登入遮罩不能確認遠端憑證已撤銷**。
- `db.auth.signOut()` 目前使用 Supabase 的全域預設 scope；如果請求成功會撤銷 Refresh Tokens，但已發出的 Access Tokens 仍會一直有效至 `exp`。原登入工作階段是否已成功遠端撤銷需額外證據，不以 UI 猜測。

## 此修補的實際範圍

1. `createClient(...auth)` 顯式使用 `flowType:'pkce'`；Supabase 將導回一次性 Auth Code（需同瀏覽器 Code Verifier），而非在網址片段直接回傳可重複使用的 Bearer Access／Refresh Tokens。
2. 在 `auth.getSession()` 完成後立即清除 Auth Code／Token 網址參數，**先於**遠端 Profile、Lesson、Role RPC。若後續 RPC 失敗、頁面顯示重新整理狀態，網址仍不包含登入憑證。
3. 移除 Hash 任意位置的 `access_token`、`refresh_token`、`provider_token` 等已知憑證鍵，保留不相關的頁面片段及經驗證的 V4 邀請參數。
4. 使用沒有真實金鑰的 synthetic regression 驗證，不透過 Codex 工具重播有憑證的 OAuth Callback。

**這是降低風險，不是消除**：PKCE Auth Code 在短時間內仍屬登入憑證，任何工具／日誌仍不得擷取完整回跳 URL；PKCE 不修復 Codex IAB 對工具輸出自動遮罩的能力。

## 必須採行的安全回應（在重新登入前）

- 若受影響者能安全進入相同瀏覽器：確認 Supabase 全域登出要求已成功；若沒有可靠證據，應由有授權的管理者透過適當的 Supabase Auth session revocation 流程撤銷受影響 QA 帳號 Sessions。**不得為了撤銷 Session 清空／刪除使用者或學生資料**。
- 如需撤銷 Google 第三方存取，可自行在 Google 帳戶「第三方應用程式和服務」管理；但**撤銷 Google 授權不等於 Supabase Session 被撤銷**，兩者需要分別驗證。
- 不再分享有 `code`、`access_token`、`refresh_token`、`provider_token` 或其類似參數的 URL；如果工具日誌仍保留敏感內容，使用平台可用的刪除／回報渠道處理，不將原始 URL 貼到 PR、AI 聊天或 Issue。
- 在確認 Supabase Token 到期、Session 撤銷，且 PKCE 修復已經隔離測試前，Codex **不得**重新觸發正式帳號 OAuth。

## 後續 QA：兩條分開的路徑

1. **安全的可重現測試（可先做）**：在專用隔離 Supabase＋合成 QA 帳號，透過現有 GitHub Actions 的 GoTrue/JWT/PostgREST/Chromium 測試身分切換與 RLS；禁止使用 Production 資料庫或真實第三方 Google 帳號作測試 fixture。
2. **Production GUI 人性化驗收（需解除阻擋）**：優先由使用者在**工具不記錄 URL 的人工環境**完成登入，並在網站呈現乾淨的 `/v2/index.html` URL 後才交給 Codex 操作 UI。若 Codex IAB 無法接續此已登入工作階段，**保持 BLOCKED**，不要讓工具再次自己跑 OAuth，亦不可手貼 Cookie／Token／Session Storage；不可為了 QA 降低 RLS／授權。
3. Team 管理者、一般老師沒有具證據的 QA 帳號／Team 關聯；建立專用隔離帳號與 Team 並核對授權前，相關 GUI 項目均是 BLOCKED。
4. Production 唯讀約束仍適用；即使登入修復 PASS，也不能自動解鎖建立課程、人工收款／退款、解除關聯、管理權轉移等寫入測試。

## Release Gate

- 修補分支 PR：以 Node regression、既有隔離 GoTrue/JWT/Chromium CI、Main SHA／Vercel Production READY 證明；新登入流程的**真實 Google OAuth 瀏覽器驗證需在無 Token 曝露的安全測試方式下另做**，未做即標 `NOT TESTED`。
- 未經核准不合併 Main、部署 Production、執行正式資料庫 Migration。
- 既有 V5.7 正式站已登入老師基本操作：PARTIAL；家長／學生、Team、RWD／UX：保持 NOT TESTED 或 BLOCKED，不冒稱整體 Alpha 可以邀請試用。
