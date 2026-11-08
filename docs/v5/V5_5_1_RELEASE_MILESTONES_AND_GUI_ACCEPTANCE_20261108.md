# 好好上課 V5.5.1｜版本終點與正式網站 GUI 驗收規格（2026-11-08）

> **決策：本階段最終版本 V5.5.1。** 這是使用者已確定的開發終點，不是 Production Migration、Main merge 或正式部署授權。繼續沿用 [PR #58](https://github.com/zhichiangai/tutor-app/pull/58)，主前端為 `v2/index.html` 與其現有模組。

## 1. 版本與 Gate

| 階段 | 完成定義 | 現況（此文件建立時） | 核准界線 |
| --- | --- | --- | --- |
| **V5.5-RC1** | 43-history 正式 V4 Schema-only 的可信隔離副本；逐份執行九份 V5-only SQL，保存 SHA 與每份 PASS/FAIL；V4 RLS/RPC/Trigger/帳務不回歸 | **PARTIAL / R3 BLOCKED**。CI clean V4+V5 的完整 V4 七類指紋 PASS，但不是正式歷史 replay | GitHub 隔離測試可做；不得對正式 Supabase 操作 |
| **V5.5-RC2** | Google OAuth／回呼、GAS/Resend 通知副作用、Service Role 管理授權、發布後關閉方案/功能的停損方式及正式風險清單完成 | **PARTIAL**；正式外部整合未完整驗收 | 不可寄真信、不讀密鑰、不改正式 OAuth |
| **V5.5.0** | 前兩關卡 GO；獲得正式資料庫與 Main 的**分別明確授權**；只執行受控的九份 V5-only 正向 Migration，先驗資料庫再整合 PR #58，Vercel READY + SHA 對齊 | **NOT AUTHORIZED / NOT DEPLOYED** | Production SQL/Auth/Main/部署須另外核准 |
| **V5.5.1** | 在正式網站完成老師/家長/學生、個人/Team、實際手機寬度的 GUI 與權限操作；修正缺陷後重新發布且複驗 | **NOT TESTED**；本 PR 新增合成行動端角色隔離 E2E，不能取代正式 GUI | Codex IAB 真正點擊與截圖，Production 僅唯讀；任何寫入測試須單獨核准並隔離 |

本輪版本號是**開發里程碑**，並未建立 GitHub Release/tag，也不代表已完成正式上線。

## 2. V5.5.1 GUI 驗收清單（給 Codex IAB）

使用 https://tutor.rapid4grad.com/v2/index.html，驗收前**必須**由 ChatGPT 確認 Vercel Production SHA 已是經授權的新 V5.5.0 Release，不可在目前 V4 網站假裝測到 V5.5.1。正式 QA 只讀；登入帳號只從本機 `/Users/fengfeng/家教小網站/TEST_ACCOUNT_ROLES.md` 取得，不回傳帳密、Session、學生資料、完整 Email。

| ID | 角色、畫面與操作 | 期待結果 | 證據 |
| --- | --- | --- | --- |
| GUI-01 | 老師｜今天、月曆、帳務、學生與家長、設定逐一開啟 | V4 個人模式五個入口均正常，舊資料顯示不跨 workspace | 各頁截圖、部署 SHA |
| GUI-02 | 老師｜設定→Team 模式→團隊、學生課表、帳務→切回個人 | 角色不變，Team 只顯示授權資料；切回可見原 V4 課程，無殘留財務卡 | 前後截圖、錯誤訊息 |
| GUI-03 | Team 管理者｜專案、老師指派、應收、付款、預收、月對帳的**唯讀入口** | 權限/資料範圍符合方案與角色，禁止在正式站按下會寫入的動作 | 每頁截圖、入口與遮罩 |
| GUI-04 | 一般老師｜Team 專案與帳務 | 只顯示被指派專案，不能看到其他老師時薪、應收總額或管理者帳務 | 可見/不可見比較 |
| GUI-05 | 家長｜首頁、已連結學生、課表、詳情、學習、分科帳務 | 不出現老師的 Team 模式切換或管理者帳務；能查看自己學生的資訊 | 角色與頁面截圖 |
| GUI-06 | 學生｜今天、課表、學習、設定 | 全程沒有學費、時薪、付款、預收與 Team 入口 | 四畫面截圖 |
| GUI-07 | 各角色｜320／375／390／430 px 下導覽與捲動 | 導覽不遺失、不橫向溢出；點擊與返回正常 | 12 組角色/尺寸證據 |
| GUI-08 | 各角色｜登出、重新整理、返回、換身分 | 未登入不洩漏 Team/個人財務；角色資料不殘留 | 登出後與換角截圖 |
| SEC-01 | RLS/JWT｜跨 Team、跨學生、管理轉讓、付款隔離、已撤銷權限 | **只在隔離合成 DB 執行寫入測試**；同一 JWT 即時隔離，無權限提升 | GitHub CI URL 與 job log |
| REL-01 | Vercel SHA、正式路由／API、DB Migration/策略、通知 | 與核准版號一致；若通知未正式部署，應明確保留 BLOCKED | 發布檢查表、網址、SHA |

**記錄格式**：每項填 `PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED`、時間、角色、尺寸、操作步驟、實際結果、證據路徑、是否寫入。任何沒做的項目不能填 PASS。

## 3. 本次新增自動回歸邊界

- `tests/e2e/v5-workspace-mode.spec.mjs` 在既有**本機 disposable GoTrue/PostgREST** 新增：320/375/390/430 px、家長與學生、禁止 Team 模式切換、學生三頁無 NT$、不橫向溢出、登出遮罩。
- 自動測試是 GitHub runner/Chromium，**不是正式站 Codex IAB GUI PASS**。
- 沿用 `V4_E2E_LOCAL=1`、絕對 fixture 路徑、`http://127.0.0.1:54321` / `3000` 封閉後端；不能連 Production。

## 4. RC1/RC2 尚待解決

1. 正式 43 筆 Migration 有 38 筆 Git Blob 位元組相同、2 筆規範化文字相同、3 筆經 V2.6 合併改寫；**真實 43-history Schema 升級演練尚未完成**。
2. 九份 V5-only SQL 的內容由 `docs/v5/catalog/V5_A1_NINE_MIGRATION_SOURCE_LOCK_20261108.json` 凍結。不得因內容鎖定與 clean CI PASS 就直接套用正式資料庫。
3. 尚需確認 OAuth 與通知外部整合、正式角色授權；不得在公開 repository 放入正式 SQL 原文、憑證或真實 QA 資料。
4. RC1/RC2 PASS 後，提出**獨立的 Production SQL 及 Main merge** 授權請求；未經授權維持 Draft 與原 V4 Production。

## 5. 完工回報

每一階段都提供 PR、Commit SHA、四項 CI、正式 Supabase migration/RLS、Vercel Production SHA、已驗證與未驗證、是否有正式寫入、下一步；達成 V5.5.1 才標記整體 PASS。
