# 好好上課｜V5.7 Production Alpha 安全 GUI 驗收操作書（2026-11-12）

**範圍**：Codex IAB 對 Google OAuth 授權請求網址的自動回報，以及老師／家長／學生／Team／RWD 的後續驗收證據。

## 已證實事實與問題歸屬

- Production 驗收基準 SHA：`8cf48e3bfcd0f11638db3141bcf47d89e11e94fe`（PR #72 PKCE 熱修）；新發布 SHA 需要重新核對。
- SEC-01 第一輪：Codex 回報登入回跳時工具輸出包含憑證形式的 URL。未保存原始值；已登出遮罩。實際 Session 撤銷仍無獨立證據。
- SEC-01 第二輪：**停在 Google 帳號選擇頁，工具回報的是 OAuth 授權請求的 `state`／延續參數**，沒有選擇帳號，沒有觀察到回呼 Access Token／Refresh Token。標記 **TOOL-URL-01 / PARTIAL**；不是同一個已證明重複 Bearer Token 外洩事件，也不能據此宣告 PKCE 失敗。
- `state` 屬 OAuth 正常防 CSRF 參數，但外部 IdP 網址仍可能有敏感狀態；工具不應把完整頁面 URL 寫入報告、存檔或 Issue。
- **此輸出由 Codex Browser 工具介面決定，無法藉修改 `tutor-app` 前端來保證遮罩 Google 網址。** 不得建立名為「網站 OAuth 遮罩修好」的假 PASS，也不得移除 Google 必要 `state`、關閉 PKCE 或削弱 CSRF／RLS 來迴避。

## 短期可執行的安全驗收路徑

### A. 完全自動化，不使用真實 Google OAuth（優先）

- 走 GitHub Actions 隔離 Supabase `localhost`，採用合成老師／家長／學生／Team 身分與 GoTrue/JWT/PostgREST。
- `tests/e2e/v5-alpha-rwd-synthetic.spec.mjs` 在 **320、375、390、430、768、1440 × 844** 對四種合成角色頁量測 `documentElement.scrollWidth`、`body.scrollWidth`，確認真實水平溢出，不以 IAB 截圖裁切推斷網站 Bug。
- 只會對合成資料作登入與點擊，不訪問 Google、不用 Production URL。完成 CI 才保留 Screenshot Artifact `v5-alpha-synthetic-rwd`（最多七天）；不得將真實 Cookies／Tokens 或截圖混入此 Artifact。
- 此項證據可以評估響應式版面與隔離角色導覽，但 **不等於** 正式站 IAB GUI PASS；QA 完成度分開記錄。

### B. Production 唯讀 GUI（條件式）

- 若 Codex IAB **已有有效的老師登入工作階段**，只操作同一已登入第一方網站的今天、月曆、課程詳情（不儲存）、帳務（不確認付款）、設定及登出。絕不可自行離開前往 Google OAuth。
- 如需家長／學生帳號，優先考慮 **Codex Chrome extension** 使用現有 Chrome Profile 中的已登入網站頁面。OpenAI 官方文件指出這可共用 Chrome 的既有 Signed-in Session；**不是保證每個帳號皆已可用**。先確認所選分頁是哪個帳號及 Production SHA，再執行唯讀操作。
- 若登入狀態不足，而 Codex 必須導航至 Google：不自動進行，標記 `AUTH-URL-BLOCKED`。可由帳號持有人在 Codex **不可見且不記錄完整 URL 的一般瀏覽器**完成授權，之後再透過已登入 Chrome 分頁進行。不要複製 Cookie、SessionStorage、Authorization Header、登入碼或 Token 給 AI。
- 禁止把 Chrome Profile 裏的敏感認證網址交給 Codex，也不得開啟 Full CDP 只為繞過工具保護、複製瀏覽器工作階段或繞過登入。
- 沒有被證實的 Team QA 管理者／老師分離帳號，就把 Team 實際權限 GUI 設 `BLOCKED`；不得用頁面角色切換冒充不同使用者登入。
- Production 遵循 `AGENTS.md` 唯讀規則，不新增／刪除學生、課程、付款、連結或 Team 權限；正式 UI 截圖包含學生／金額時不得分享未遮罩畫面。

## 不得重複進行的驗收

- 不要為了「測遮罩」反覆讓 Codex 自動導航 Google OAuth。
- 不要叫 Codex 去讀取／轉貼網址列、Network、Console／CDP 含敏感參數的原始請求。
- 不要依 IAB 顯示網址中的 `state` 直接判斷已發生 Access Token 外洩；兩個事件要分開。
- 不要在未取得受影響 Session 撤銷證據前宣告先前 Token 已失效。

## Codex 報告格式

對每個案例記錄 `角色、頁面、Viewport、預期結果、實際結果、PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED、可核實的證據`。

- RWD 如有「裁切」，優先找 `scrollWidth > clientWidth` 的 DOM 幾何證據。IAB 無 DOM 量測權限時，標記 `PARTIAL` 並引用隔離 CI 證據，不能猜。
- UX 建議只把實際觀察到的項目列為 Evidence-based；未互動過不報 Bug。
- 最終 Alpha 對外邀請閘門維持 **BLOCKED**，直到家長、學生、Team 權限、重要 UX 和 Auth 安全登入路徑都有獨立證據。

## 參考

- OpenAI 官方：<https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app>（IAB 與 Codex Chrome extension 的既有登入工作階段差異）
- 本專案：`docs/security/V5_OAUTH_IAB_CALLBACK_EXPOSURE_20261112.md`
- 本專案：`AGENTS.md`、`docs/v5/V5_PRODUCTION_ALPHA_RUNBOOK_20261112.md`
