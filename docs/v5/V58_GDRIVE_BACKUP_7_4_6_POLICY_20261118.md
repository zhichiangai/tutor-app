# 好好上課 V5.8｜Google Drive 備份決策與 7／4／6 保留策略（2026-11-18）

> **已確認的產品決策**：現階段使用 Supabase Free＋GitHub Free＋Google Drive。備份保留 **7 個每日、4 個每週、6 個每月版本**。未來營利升級 Supabase Pro 後，使用「Supabase 官方備份＋Google Drive 獨立加密備份」雙備援。
>
> **狀態：PARTIAL／仍 NO-GO。** 本文件不授權正式 DB 匯出、移轉、Migration 63、Main 合併、Production 部署、刪除資料或購買付費資源。

## 1. 架構與成本

| 系統 | 現階段職責 | 營利後職責 |
| --- | --- | --- |
| Supabase | Free：正式 DB；不依賴其每日備份 | Pro：官方每日備份（留存期、PITR 依當時方案核實） |
| GitHub Actions | GitHub Free：執行排程、PostgreSQL17 備份、age 加密、雜湊檢查；不持久儲存 dump | 繼續作為 Google Drive 獨立備份的執行引擎 |
| Google Drive | 已付費 Google 儲存空間：保管多版加密密文及無敏感索引 | 作為 Supabase 以外第二故障域 |
| GAS | 非必要，不作為 PostgreSQL 完整備份引擎 | 有需要時才加上通知功能 |

Google 個人儲存空間不等於 Google Cloud Run 計算服務。此階段不增加額外固定雲端費用，GitHub 用量限制仍需監測。

## 2. 保留規則與加密

- 每日保留最近 **7 個不同 UTC 日期**各最新的一份；每週保留最近 **4 個不同 ISO 週**各最新的一份；每月保留最近 **6 個 UTC 日曆月份**各最新的一份。取聯集，不重複保留；由於跨日期重疊，實際份數可能少於 17。
- 重大 Migration 前「release snapshot」與明確標記 hold 的版本永久保留直到人工解除；尚未通過加密、上傳與 SHA-256 完整性驗證的檔案不能列為可淘汰。
- 只有最近一次有效備份不超過 **36 小時**，而且 **45 天內完成隔離資料庫真實還原演練**，才能產生「供人工審查的過期版本清單」。任何條件不通過，保留全部。**現階段程式完全不執行刪除**。
- 使用單次 PostgreSQL17 pg_dump Custom Archive 做一致的 DB snapshot，在進入 Google Drive 前使用 age/X25519 **公開金鑰**加密。私鑰獨立保管，不可存在 Github、Drive 或 CI；雲端執行環境短暫處理原始 DB，不能宣稱零接觸。
- 額外的 roles、Supabase managed schema、Auth、RLS、RPC、Migration History 及 Extensions 都必須單獨核實；Supabase Storage 物件本體不在 DB dump 內，未來有教材／照片須另備份。
- 先上傳成功、再下載比對密文 SHA，絕不將未加密資料存入 Drive。SHA 比對只能證明密文傳輸完整，**不能代替真正還原測試**。

程式：scripts/release/v58-gdrive-retention-plan.mjs
單元測試：tests/v58-gdrive-retention-plan.test.mjs

此工具純離線讀取不含個資、密碼的 JSON Catalog，計算 KEEP / REVIEW_FOR_RETIREMENT；不連接 Drive、不清理舊檔、不啟動 Production 工作。缺漏排程仍須獨立警報；「最近 7 個有效備份日」不代表一定連續 7 天成功。

## 3. GitHub Actions 與 Google Drive 權限

- 正式備份 Job 只能從經保護的 main 執行，使用受限 GitHub Environment 與只讀 GitHub Token。絕不允許 pull_request、pull_request_target 或 PR 內容取得 Production Secrets；絕不把 dump 上傳 Actions Artifacts。
- 每日 schedule + 受控 workflow_dispatch。GitHub 排程僅在 Default Branch 生效，可能延遲或被停用，因此需要獨立缺漏監控。若設每日人工核准，排程會停在待批准，必須以 main 限制、環境授權、最小權限與審查保護長期自動工作。
- 個人 Drive 使用專用 OAuth App，最小 drive.file 權限。備份資料夾由該 OAuth App 建立或取得明確授權，不可將「聊天中的 Google Drive 連線」誤當 GitHub Actions OAuth。client_secret、refresh_token 只能保存在受保護 Secrets，不可貼入聊天或 PR。Google OAuth External Testing 階段的 refresh token 可能短期到期，應先合法完成長期授權設定。
- 首次端到端門檻：GitHub Actions → 合成 PostgreSQL17 Archive → age → 真實 Google Drive API 上傳 → 取回 SHA → 解密 → **隔離 PostgreSQL17 真正還原**。未實際通過前不能宣稱自動備份已運作。
- 日後清理舊版需要**另外的人工授權與防誤刪設計**；此階段只輸出候選清單，不呼叫刪除 API。

## 4. 還原流程及雙備援

**現階段（Supabase Free）**：從 Google Drive 下載指定日期密文 → 安全獨立取得私鑰 → SHA 驗證 → 在隔離資料庫還原 → 比對帳務、Auth、RLS、Migration、角色與受管 Schema → 人工確認正式切換方案。**不能直接覆蓋 Production**。

**營利後（Supabase Pro）**：一般資料問題優先考慮 Supabase 官方每日備份；Google Drive 加密備份保留為獨立的另一份。兩條還原途徑皆需演練；要將最差資料損失壓低於接近 24 小時，另評估 PITR。

## 5. 本輪實作範圍與未完成事項

- 本輪先建立 7／4／6 唯讀保留計畫程式、純合成測試、GitHub Actions 合成 CI 整合，並更新本設計及 PoC 文檔。
- **尚未**配置獨立 Drive OAuth、受保護正式備份 Secrets、真正每日 Production 排程、正式資料匯出、Google 正式資料副本、隔離 Supabase 真實完整還原。
- 專案知識中的 AI_DEVELOPMENT_MASTER_RULES.md 應更新為下一版本，寫入已選定的新備份方向；它是規範，不可將計畫誤記為已啟用。
- PR #83 繼續 Draft / NO-GO。對 Production SQL 63、Main Merge 和正式部署分別需要本次獨立批准。

官方參考：
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/deployment/ci/backups
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
