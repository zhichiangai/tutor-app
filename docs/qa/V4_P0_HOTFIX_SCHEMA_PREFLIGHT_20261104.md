# V4 P0｜正式付款 RLS 修補相容性唯讀核對（2026-11-04）

> **狀態：SCHEMA PRECHECK PASS，但正式發布仍 NO-GO。**
> 本文件是 Production 唯讀 schema 基線，不是備份、還原、實際登入、Hotfix 套用或任何發布授權。
> 沒有讀取或輸出學生、付款資料列、Email、Token 或帳號識別資訊。

## 交付範圍

- 正式 Supabase：`vctisuglfoxyuwlvyjee`。
- 檢查 SQL：`supabase/diagnostics/v4_p0_payment_rls_hotfix_preflight_readonly.sql`。
- 獨立候選 Hotfix：`supabase/hotfixes/20261028_parent_payment_active_link_select.sql`（**尚未套用**）。
- 離線安全測試：`tests/v4-p0-payment-hotfix-preflight-contract.mjs`。
- 主要整合 PR：#43。V4 是否可發布仍由 `docs/qa/V4_RELEASE_EXECUTION_GATE_20261029.md` 的 Gate 判斷。

## 2026-11-04 正式唯讀結果

| 欄位／條件 | 實際結果 | 唯讀判定 |
| --- | ---: | --- |
| Production migration history | 29 | 與已知基線一致 |
| Hotfix 需要的身分／關聯欄位 | 15/15 | 結構存在 |
| 目標 SELECT 政策 | 3/3 | 存在 |
| 目標 authenticated／permissive 政策 | 3/3 | 存在 |
| 額外 SELECT／ALL 政策 | 0 | 未見會與本候選疊加的額外政策 |
| 目標政策含有效 guardian link | 0/3 | **正式安全風險尚未修補** |
| 付款三表＋student_guardians RLS | 4/4 | 均啟用 |
| student_guardians 的 authenticated SELECT 政策 | 1 | 存在 |
| authenticated 可查詢 guardian 連結表 | true | 有表級 SELECT 權限 |
| guardian SELECT 對付款／請求表引用 | 0 | 未見直接政策循環 |
| 正式 payment_batch_corrections | 不存在 | V4 schema 尚未部署 |

**結論：** 目前 schema 的基本結構與候選 Hotfix 相符，可進入「隔離還原／JWT 行為驗證」階段。這不能證明 Hotfix 在正式 29 migration schema 上實際套用一定成功，也不能保證任何資料列的讀取結果正確。GitHub Actions 全部 PASS 亦不可取代這項驗證。

## P0 正式修補前必須完成

1. 取得當下 Production 的**完整且可還原的授權備份**；包含 Auth／FK／Migration history。於隔離環境實際還原，留存不含個資的數量、checksum 與 schema 比對證據。
2. 在與正式 29 筆 schema 相符的隔離副本**單獨重播 Hotfix**；不能僅用完整 V4 空白環境遷移測試冒充。不要直接使用 `supabase db push`、`migration repair`。
3. 使用實際 JWT/REST 角色測試：有效連結家長讀得到自己的批次、解除後同一 JWT 不可再讀、歷史 batch ID 不可讀、老師仍可讀、其他老師／學生／匿名被拒；同時確認付款資料列數與金額沒有改變。
4. 明確審核 Hotfix 執行 SQL、備份、回復方案、影響與時間窗口，**另行取得使用者對正式 Hotfix 的授權**。正式 Migration 和合併部署都需要各自的授權，不可合併推定。
5. 發布後重新執行唯讀 schema preflight 與授權行為 smoke test；只讀輸出應由已固定的 0/3 改為 3/3，但仍需要檢查其他實際權限。

## ChatGPT × Codex

**ChatGPT** 負責程式、隔離資料庫、安全測試與 GitHub CI；必要程式測試通過才建立附 PR／SHA／Preview 的任務。**Codex** 只使用 Codex Desktop **內建瀏覽器 IAB** 實際點擊唯讀網站，回傳截圖、PASS/FAIL/BLOCKED 與直接交給 ChatGPT 的 AI Prompt。Codex 沒有 IAB 控制工具時，標記 BLOCKED，不以 Playwright 或 API 冒充點擊測試。

**這份 P0 schema 診斷不是 Codex 的 UI 驗收項目，也不是讓 Codex 直接套用 Hotfix 的指令。**
