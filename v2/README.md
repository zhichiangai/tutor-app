# 好好上課｜正式網站前端（V3.5.1）

> **這個目錄 `v2/` 是目前正式 V3.4 的實際前端程式**，名稱 `v2` 沿用歷史版本，不代表網站仍在使用 V2 或 GitHub Pages。請勿照舊版 README 的 GitHub Pages／GAS 設定修改正式 OAuth。

## 正式服務

- 正式網站：<https://tutor.rapid4grad.com/>
- 程式儲存庫：<https://github.com/zhichiangai/tutor-app>
- 前端部署：Vercel `tutor-app-v2`，來源為 GitHub `main`。
- 身分驗證：Supabase Auth Google OAuth。
- 資料庫：Supabase PostgreSQL，Project Ref `vctisuglfoxyuwlvyjee`。
- 主要檔案：`index.html`、`app.js`、`style.css`、`scheduling.js`、`calendar-view.js`、`payment-ledger.js`。
- 資料庫版本位於 `../supabase/migrations/`；新增 migration 必須另外套用到對應 Supabase 專案。

## 三方排課與單堂補課規則

老師、已連結家長、已連結學生操作**同一份課程**。家庭共同排課的寫入透過 `shared_course_action`，後端驗證實際帳號與學生關聯。學生入口不回傳費率、付款批次或金額。

固定課表的原定日（`original_date`）必須符合每週／雙週規則；**單堂補課目的日（`moved_to`）可以是其他星期、雙週的非上課週，只要不與同一學生或老師其他課程撞期**。例如雙週星期三 12/16 的課，移至 12/23 是合法補課，不代表整組課表改成每週；12/30 原定課程照常。若要改整組規則，請使用「修改未來固定課表」。

V3.4 加入強制版本檢查、防止撞期、取消者稽核及雙週原定日驗證。V3.4.1 針對共享排課的拒絕操作，在表單中保留可見的錯誤訊息，避免 3.5 秒 Toast 消失後不知道失敗原因。

## 驗收與維護

1. 本地：`node --test tests/*.mjs`，並檢查語法。
2. 合併 GitHub PR 前確認 Actions 全數通過。
3. 確認 Vercel Production deployment 的 Git Commit 對應最新 `main`。
4. Supabase 權限以真實 Auth UID／連結關聯為準；不可為了解決前端錯誤而關閉 RLS 或放寬 RPC。
5. 使用獨立測試老師、家長、學生完成課程新增、取消、補課與資料隔離驗收；不得修改真實學生和付款記錄。

正式架構及安全說明：[根目錄 README](../README.md)、[V3.4 驗收清單](../docs/v34-shared-schedule-validation.md)。

舊版 V2.1～V2.7 使用與 GitHub Pages／GAS／OAuth 待設定敘述，請改看 [V2 歷史文件](../docs/legacy-v2-readme-20261020.md)。這些內容**不是目前正式部署狀態**。

## V3.5 更新（2026-10-21）

正式站移除互動預覽入口，新增獨立設定分頁（角色模式、顯示名稱與家教空間），老師課後記錄上課內容／專注度／學生心情及備註，家長付款明細逐堂顯示上述資訊。學生只能讀取學習資訊，不含付款金額。詳見 [V3.5 文件](../docs/v35-settings-learning-billing.md)。

## V3.5.1 權限修正

補齊 `authenticated` 對 `profiles`、`workspaces`、`guardian_invites` 必要欄位的 UPDATE 權限，搭配既有 RLS 保護。正式使用者可儲存角色勾選、顯示名稱、最後模式、自己家教空間名稱，及未接受邀請的家長 Email，其他敏感欄位不開放修改。
