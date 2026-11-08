# 好好上課 V5｜乾淨 V4＋V5 後端建置與正式上線檢查（2026-11-08）

> 本文件延續 PR #57；使用者已決定舊正式資料都是可捨棄測試資料，不需要保留或移轉。本文件**不授權直接清除 Production、改 Auth、合併 Main 或部署網站**。

## A. 不能消失的產品功能

- 同一套網站、同一登入系統，老師從「設定 → 使用模式」選擇「個人家教（V4）」或「Team 團隊（V5）」。
- V4 個人家教的今天、月曆、個人帳務、學生與家長、設定，以及家長／學生原有的課表與學習紀錄都要保留。
- V5 Team 學生、跨老師課表、專案、管理者帳務與預收抵扣使用獨立資料結構，UI 切換不能授予任何新 RLS／RPC 權限。
- 家長、學生維持原角色介面，學生不得接觸費用。

## B. 本輪實際唯讀現況

- 正式 Supabase vctisuglfoxyuwlvyjee：ACTIVE_HEALTHY、PostgreSQL 17、43 筆 migration history。
- GitHub V5.5 分支：46 份 migration SQL，其中 9 份 V5.1–V5.4。正式 43 筆與 repo 46 份並非相同歷史，**禁止直接對正式庫 db push / migration repair / reset**。
- PR #57 個人／Team UI：Node 312/312、合成隔離 Chromium 38/38 PASS，不代表 Production 已上線。

## C. 新增乾淨資料庫 Gate

只在 GitHub Actions 一次性、未連結正式 Project 的 Supabase local stack，先執行 supabase db reset --local --no-seed，然後使用 tests/local/v5-clean-bootstrap-gate.mjs 驗證：

1. Repo 版本號與實際套用的 schema_migrations 完全一致。
2. V4 八張核心表與 V5 從 CREATE TABLE 定義推導的全部 public / tutor_private 表均存在且啟用 RLS。
3. 匿名者無直接 V5 table SELECT；一般已登入使用者不能直接讀私有 Team 帳務與稽核表；敏感 RPC 不能供匿名執行，服務專屬管理 RPC 不能供一般登入者執行。
4. Auth users、V4 學生／課程／付款及 V5 Team 學生／課程／人工付款均為零筆，保證未帶入舊假資料。
5. 只有 CI=true、V4_E2E_LOCAL=1、沒有 hosted project link，才能執行。
6. 其後必須繼續通過真實 GoTrue JWT、RLS、V4 操作、Team 帳務、38 項 Chromium 與 320/375/390/430 px 測試。

## D. 正式切換待選方式

- **方案 A：沿用目前 Supabase 專案**，需要經核准且受控的 Schema／Auth 清理與重建；不能在 43 筆正式 history 的狀態下直接套用 46 個本機 Migration。既有 OAuth/回呼、RLS、Storage、外部通知須確認。
- **方案 B：全新正式 Supabase 專案**，可乾淨執行 46 個 Migration，但需先核對 Free 名額、實際成本和 Google OAuth、Vercel 環境變數設定。沒有使用者核准就不建立額外付費資源。

兩者都不需要移轉舊測試資料。選定且核准後：**正式後端就緒 → 依 PR 依賴整合 Main → Vercel Production SHA 核對 → Codex 三角色與手機 GUI 真實驗收**。

## E. 本 PR 的權限界線

- 僅新增乾淨 Schema 的合成 CI 檢查、文件與 PR。**不修改正式 DB、Auth、OAuth、RLS 或部署**。
- CI PASS 不等於正式環境可以直接 reset 或已達 Production GO。
- 本機 B Stack 的 wildcard ports 風險屬獨立事項，資料不用保存不代表安全問題已解除。
