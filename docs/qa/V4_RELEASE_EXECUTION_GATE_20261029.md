# 好好上課 V4｜正式發布執行門檻與 Migration 歷史落差（2026-10-29）

> **狀態：NO-GO。** 這是截至 2026-10-29 的唯讀基線；不可視為正式變更授權。本文件不保存任何學生個資、付款明細、資料庫密碼或 API Secret。正式服務、正式學生與付款紀錄均未修改。

## 已由連接的服務唯讀核對

| 項目 | 實際確認 |
| --- | --- |
| 正式 Supabase | `vctisuglfoxyuwlvyjee`，29 筆 `supabase_migrations.schema_migrations`，最後版本 `20261022110047` |
| V4 開發分支 | `chat/v4-release-integration-20261029`，PR #43，**Draft 未合併** |
| GitHub `supabase/migrations/` | **37 份** SQL；其中 28 份為本機重播的舊基線，後續 9 份為 V4／V3.5.9 候選 |
| 版本編號一對一相符 | 只有 **11／29**；其餘正式紀錄中 **18 個版本編號**不直接對應 GitHub 歷史檔 |
| 舊歷史重整 | 正式 29 與本機重播 28 份不是一對一；部分版本重新命名、重整，**尚未逐筆驗證 SQL 語義等價** |
| 付款 RLS | 正式 3 條目標 SELECT 政策存在，3 張表 RLS enabled；**0／3** 包含有效家長關聯檢查 |
| V4 正式 schema | `students.is_qa` 不存在、`payment_batch_corrections` 不存在；不可把 Preview/CI 功能當正式可用 |
| 雲端測試 | 上一輪 PR #43 的 isolated Chromium **10/10 PASS**，但沒有證明正式 schema 相容或正式 OAuth |

完整版本清單：`docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json`。

可在正式資料庫**只讀**重查：`supabase/diagnostics/v4_production_release_preflight_readonly.sql`。查詢不含修補、備份或資料修改；無論查詢結果如何，`release_gate` 均為 `NO_GO_RESTORE_AND_APPROVAL_REQUIRED`，不會自行核准升級。

## 為什麼禁止直接推送 Migration

Repository 的 37 份檔案含本機為空白環境重播的歷史重建版本。正式 Migration history 29 筆中有 18 個時間戳無對應檔案，且本機重播舊版只有 28 份。

因此 **禁止**：
- 對 Production 執行 `supabase db push`、`supabase migration repair` 或整套空白環境 `supabase db reset`。
- 憑相同功能名稱、語意相近或時間順序就把 18 個正式紀錄標成已套用。
- 將後續 9 份 SQL 當作可直接在 Production 執行的既定清單；仍需逐份 schema diff、相依性及 transaction 審查。

## V4 完成前的安全工作順序

1. **先處理 P0 家長解除關聯後仍可看到舊付款的風險。** PR #43 有獨立防呆候選 `supabase/hotfixes/20261028_parent_payment_active_link_select.sql`；先用與正式 schema 相符的隔離庫重播獨立 Hotfix，真實 JWT/REST 交叉驗證連結中、解除後、歷史 ID、不同老師、學生、匿名、並發。不要因為完整 V4 隔離測試通過，就假設這個 Hotfix 已在**舊版 29 筆 schema**獨立測試通過。
2. **新鮮正式備份 + 隔離還原證據。** 以授權方式取得完整 schema／資料／Auth 相容備份，保存於加密與存取受限的位置；不提交 Git、不張貼對話。隔離還原驗證需保留原學生／課程／付款／Auth 關聯及筆數，並檢查 checksum、Migration history、RLS、重要 RPC；任何無法完成的備份不得視為 PASS。
3. **版本對照及向前相容方案。** 在隔離還原庫比較正式 29 筆結構與候選 SQL；列出差異、前置條件、順序、可重試性與失敗復原，另編正式專屬可審查方案。因為歷史版號不一致，絕不可盲目依檔名時間執行或修表。
4. **隔離驗收。** 後端 GoTrue JWT、付款分批／更正／QA 審計／RLS、三角色跨帳號同步、固定課表、Google OAuth 真實網域，以及 Codex 滑鼠驗收（320/375/390/430px）；CI 的合成 email/password **不算** Google OAuth PASS。
5. **發布權限。** 由 ChatGPT 統整 signed-off commit SHA、CI run、備份／restore 證據與完整回復方案；由使用者另行明確授權 **正式 Hotfix**、**正式 Migration**、**合併/部署**，這三種授權不可互相推定。發布後再做唯讀功能及 RLS 健康檢查。

## Codex 與 ChatGPT 分工

- **ChatGPT：** 維護 PR #43、SQL/RLS、CI、版本對照、隔離資料庫合成測試及發布 Gate。停止擴大 V5 的實作，直到 V4 安全發布。
- **Codex：** 操作 Mac Docker Desktop、Terminal、實際瀏覽器滑鼠／觸控及截圖。既有 Mac `tutor_v4_isolated` 有 21 個合成 Auth 帳號；先按 `docs/qa/V4_MAC_LOCALHOST_BIND_RECOVERY.md` 驗證 LAN isolation、Volume／備份，不能 reset 或覆寫。
- **使用者：** 核准正式資料與 Production 相關高風險操作；未授權保持 Draft / NO-GO。

### 本階段不能宣稱已完成

- 無正式備份還原成功證據。
- 無與 Production 29 筆 Schema 完全相容的 V4/Hotfix 單獨驗收。
- 無正式 Google OAuth／跨裝置實機全驗收。
- 正式付款 SELECT RLS 仍未修補；正式 V4 資料結構未升級。
- Supabase Advisor 的 5 個 `SECURITY DEFINER` 警告需逐項審查執行權限與實際 RLS／函式內部身分授權，不能因警告就擅自撤銷必要的 RPC。
