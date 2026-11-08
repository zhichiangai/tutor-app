# 好好上課｜使用者選擇 Main 優先驗收（2026-11-08）

**當次產品負責人決策**：不新增需額外連動 GAS/OAuth 的 Preview Supabase 環境，改以 Main/Production 網站為 GUI 修正的主要入口。這是針對 **GitHub Main 程式碼合併與其 Vercel 自動部署** 的當次許可，不代表授權執行正式 Supabase Migration、改 RLS/Auth、重設資料、發信或付款。

## 當次合併範圍
- 一次性將 #59 以 `main` 為 base（包含上游 #58 的 V5.5 模組）合併，避免先後兩次 Production 部署；
- Main 對應 Vercel Production 將包含 V5.1–5.7 程式碼及 SQL **檔案**，**SQL 檔案存在不等於正式 Supabase 已執行**；
- 正式 Supabase 僅有 43 筆 V4 Migration，截至本次核對尚未新增任何 V5 表、RPC、RLS；Team 頁面在正式 DB 尚無 V5 RPC 時應清楚顯示尚未啟用，禁止假稱完整 V5.7 正常。
- 舊 V4 正式 Google 登入、老師、家長、學生、個人課表／帳務維持可用是第一個 Smoke Gate；若登入、主畫面或資料隔離出現重大回歸，即停止驗收並優先修復／撤回程式部署。
- **注意**：Codex IAB 工具缺失與 Main 是否合併無關。部署到 Main 不能修復 IAB 缺少滑鼠／截圖工具。

## 風險及停損
- 程式已部署 ≠ V5 DB 啟用。V5 Team 工作空間要測真實功能，必須另有明確授權並通過正式 43-history schema 相容演練、備份與漸進 Migration 計畫。
- 無 V5 RPC 時，不能進行 Team 付款、抵扣、退款、管理轉讓等寫入。尚未完成的 V5.6 更正／退款亦不能宣告上線。
- Vercel Production 版本應與 Main SHA 一致、READY；資料庫 Migration 仍 43。
- 正式站僅唯讀 UI 驗收，未經同意不得操作真實學生或付款資料。若 Codex IAB BLOCKED，不能把 Chromium CI 代替真人 GUI 證據。
- 若正式站存在重大錯誤，優先修復 V4 回歸或將程式回復至合併前部署 SHA，**不能**以直接清空 DB 解決前端問題。

## 版本
V5.7.0 程式碼整合候選 ≠ V5.7.0 正式功能完成；正式資料庫與 V5.6 訂正／退款依舊 NOT TESTED / BLOCKED。
