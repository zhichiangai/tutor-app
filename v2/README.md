# 好好上課｜現行網站前端（歷史路徑 `v2/`）

> 目前唯一維護的正式 UI 位於 `v2/`；先閱讀 [根目錄 AGENTS.md](../AGENTS.md) 與 [專案 README](../README.md)。不要重新啟用舊版 V1/V2 程式。

## 對應服務

- 網址：https://tutor.rapid4grad.com/v2/index.html
- GitHub：`zhichiangai/tutor-app`；Vercel：`tutor-app-v2`；正式部署從 `main`
- Supabase：`vctisuglfoxyuwlvyjee`（Google OAuth／PostgreSQL／RLS／RPC）
- 網站根路由：`vercel.json` rewrite 至 `/v2/index.html`

## 檔案地圖

| 模組 | 用途 |
| --- | --- |
| `index.html`, `app.js`, `style.css` | 三角色畫面、登入、路由、課表與 RWD |
| `calendar-view.js`, `scheduling.js`, `lesson-actual.js` | 日曆、固定課程、改期及實際時數 |
| `payment-ledger.js`, `payment-correction.js` | 個人家教帳務與更正 |
| `v4-connections.js`, `v4-contacts.js`, `v4-config.js` | V4 雙向邀請、聯絡人、部署設定 |
| `v5-plans.js`, `v5-team.js`, `v5-learning.js`, `v5-billing.js`, `v5-operations-summary.js` | V5 方案、Team 專案、老師／學生、帳務及營運摘要 |

## 角色與邊界

- 老師：個人家教的五頁導覽及課程、課後紀錄／帳務；在有權限且後端已啟用時可選 Team 模式。
- 家長：已授權學生的課程、學習、付款狀態；不應看到其他家庭或 Team 管理者資料。
- 學生：自己的今天／課表／學習／設定；**不應讀取時薪、課程金額、付款或 Team 管理帳務**。老師填寫的課後文字屬學生可見內容，輸入端應提醒避免放入財務／QA 測試文字。
- UI 角色切換不是授權；所有存取仍應由資料庫 RLS 與經驗證的 RPC 決定。

## 發布安全

截至 2026-11-09：Main／Production 是 PR #66 的 `5b147cb` 版本，V5 Team 正式後端尚未啟用；當前 [Draft PR #67](https://github.com/zhichiangai/tutor-app/pull/67) 在分支進行品質整合。**當下版本需重新查證，不能把本文快照當作即時證據。**

- V5 十份 Migration 正式啟用閘門見 `docs/v5/V5_7_A1_TEN_MIGRATION_RELEASE_GATE_20261109.md`；沒有 43-history Schema-only 隔離演練證據前不得宣告 Production 可套用。
- GitHub 隔離 CI 測試 ≠ Vercel Production 確認 ≠ Codex IAB GUI 實測。
- Codex 優先本機 GUI，請在 Mac 按專案交接 MD 地圖及 `TEST_ACCOUNT_ROLES.md` 找對應的正式 QA 帳號；禁止將機密寫入提交、截圖或交接摘要。
