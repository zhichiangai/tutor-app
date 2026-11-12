# V5 發布候選審查｜2026-11-11（Asia/Taipei）

> 狀態：**RELEASE CANDIDATE / NOT YET PRODUCTION GO**。本文件只保存經查證的證據與未解除的門檻；不變更 19 份 Source-Locked SQL、正式資料、Auth 或 migration history。

## 固定版本與依賴

- Release Branch: `release/v5-20261111`; Release PR: #69，base `main`。
- 原始整合：PR #68，SHA `b6be697647cd51d23140f423e1dda9debe1bc49f`，包含 V5 Free/Plus/Team、Team 課程與管理、人工付款、預收、退款反向分錄、淨額報表，以及 QA-PREVIEW-01 修正。
- Source-Lock: `docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json`，共 **19** 個 forward SQL，仍註明 `approved_release: NO_GO`。
- 離線打包／校驗器：`scripts/release/package-v5-43-plus-19.mjs`，僅複製 43＋19 已審查 SQL，不連線資料庫，不執行 Migration；`node scripts/release/package-v5-43-plus-19.mjs check` 僅查驗來源 SHA。
- Production Supabase project ref: `vctisuglfoxyuwlvyjee`，正式 Migration 43 筆，最後 `20261103212647`；正式 V5 物件尚未安裝。
- `main` 連動 Vercel 專案 `tutor-app-v2` 的 Production。**不能先 merge 再假設 Vercel 會等待**。

## 已有可追溯的證據

- PR #68 的 `b6be697647cd51d23140f423e1dda9debe1bc49f` 五項 GitHub Actions PASS。
- [V5 A1-R3 歷史升級測試](https://github.com/zhichiangai/tutor-app/actions/runs/42871821448) PASS：以真正 43-history SQL 在隔離 Supabase 重建結構、追加 19 份凍結 SQL → 62 筆；V4/V5 核心 RLS/RPC 與三角色 JWT/Chromium PASS。
- 同一 CI 的**有資料升級驗證** PASS：先建立合成 V4 老師、家長、學生、課程與待確認付款，然後追加 19 SQL；Auth/V4 業務資料指紋不變，V5 方案與歷史學生名額初始化正確。
- Production 7 類 V4 結構指紋唯讀重查與 2026-11-08 正式基準完全一致：35 tables／287 columns／192 constraints／117 indexes／56 policies／27 triggers／54 functions，全部零差異。
- Production public 23/23 RLS enabled，私有表未直接授予瀏覽器角色資料存取。上述是 metadata 證據，不等於所有 RPC 端到端越權測試。
- Codex 已對上一版 PR #68 SHA `43c0a43ab3cf137b8178988847e7578ac3436686` 的 Vercel Preview 驗證 QA-PREVIEW-01 **核心 PASS**，其他手機尺寸及寫入控制 **PARTIAL**。**不可挪用到新的 Release SHA 的正式站 GUI PASS。**

## 本輪帳務審查

- `v5_team_payment_overview` 的 `confirmed_payments_cents` 是**退款前的原始已確認人工付款總額**，保留不可變付款歷史；不可與銀行驗證後的入帳淨額混用。
- 同一 RPC 的每堂課 `direct_allocated_cents`、`advance_applied_cents`、`outstanding_cents` 走 V5.6 **refund/reversal net helpers**；V5.7 各專案報表亦以退款後淨額計算 `direct_net_cents`、`advance_net_cents` 和 `outstanding_cents`。
- `v56_team_conservation_overview` 按追加式人工退款宣告計算現金帳面淨額；輸出 `bank_verified:false`。這不是銀行交易成功證明，不能自動寄送退款通知或宣稱已返款。
- 本 Release 僅為管理介面補上「原始付款（退款前）」標示，並加入契約測試；**不能**將完整會計淨額／銀行核帳標記為已完成商業驗收。

## 正式發布 GO / NO-GO

| 門檻 | 現況 | 證據／解除方式 |
|---|---|---|
| 19 SQL source-lock | PASS（內容與 CI 凍結） | 既有 Source-Lock 與 A1-R3 builder SHA 驗證 |
| 真實 43-history → 62 隔離 SQL 相容 | PASS | CI 42871821448 |
| 既存 V4 合成資料保持及 seat backfill | PASS | CI 42871821448 |
| 三角色 JWT/RLS/Chromium 隔離驗收 | PASS（合成環境） | 同一 CI；正式站仍未驗收 |
| 淨額、退款、歷史帳務界線 | PARTIAL | 需覆核所有讀取模型與業務呈現，禁止把原始付款當作銀行淨收入 |
| 生產 Migration **原版號 19 筆** 可重現部署與停損 | BLOCKED | 需以可保存檔名版號的 Supabase CLI 受控執行。現有 MCP `apply_migration(name,query)` 不提供指定歷史版本欄位，不能在 Production 試錯 |
| Vercel tutor-app-v2 Production 目標與 SHA 的連接權限 | BLOCKED | 本 ChatGPT 的 Vercel connector 無法讀取該專案，Codex 曾以 Dashboard 核實 Preview；需部署前實查 Production |
| 正式資料庫版本 62 / Main / Production READY | NOT TESTED | 尚無實際授權執行的安全部署通路，Production 不可提前寫入 |
| Codex 三角色及 Team 的 Production GUI | NOT TESTED | 正式版本 READY 及安全資料庫升級後才執行 |

## 正確發布操作（待環境、指紋與版本門檻達標）

1. 凍結 Release SHA、重新核對 `main`、Production SHA、43 筆 DB 歷史 MD5 與 19 SQL Git blob SHA；不允許版本移動。
2. 使用與 CI A1-R3 **相同已審核**的 43-history SQL + 19 forward SQL 產生專用發布目錄，**不得**把 Repository 原有 56 份歷史 SQL 直接 `db push` 至已存在 43 筆歷史的正式庫。
3. 在擁有正式 DB 連線但不輸出憑證的受控環境執行 Supabase CLI `db push --dry-run`，確認精確只有 19 份新 Migration；任何時間戳不符、歷史漂移、缺少預期來源或意外重播都立即停止，禁止 `migration repair`。
4. 先確認已具備緊急停用／向前修復方案、Vercel 正式專案權限與可發布路徑；再以已審核的 19 份逐序升級，記錄每一個版本的結果。
5. 逐項實查 62 版本、V5 表/RLS/RPC、V4 功能與身份關聯正常，再合併 PR #69 到 Main；核對 Vercel Production READY SHA。
6. 最後由 Codex IAB 登入三角色與 Team 完成正式站 GUI；未測不得標記 PASS。

**禁止**：從 `main` 提前部署未準備好 Schema 的 V5、全 repo `db push`、`db reset`、`migration repair`、清空 Production、輸出 OAuth/Token、以 PR/Preview CI 代替正式驗收。
