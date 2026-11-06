# 好好上課 V5.1–V5.4｜正式發布安全門檻與 Migration 對照（唯讀，2026-11-06）

> **結論：NO-GO。** 本文件是從目前 GitHub、正式 Supabase metadata 與 Vercel 的唯讀查證整理，不是發布授權或正式資料備份。
> 禁止對 Production 執行 `supabase db push`、`migration repair`、`db reset`、未審查的 SQL、Main 合併、部署或資料更正。V5 只能在隔離資料庫測試。
> 動態證據檔：[`V5_PRODUCTION_MIGRATION_READONLY_SNAPSHOT_20261106.json`](./V5_PRODUCTION_MIGRATION_READONLY_SNAPSHOT_20261106.json)。每次發布前必須重新唯讀查證，不可當作未來永遠正確的狀態。

## 1. 本輪正式環境事實（2026-11-06 台灣時間）

| 項目 | 已查證事實 | 界線 |
| --- | --- | --- |
| GitHub Main | `894a6228994c3fb0f1c1448aa6d470c56f90053e` | V5 尚未合併 |
| Vercel Production | `tutor-app-v2`，最新 Production deployment `READY`，Git SHA 與 Main 一致 | 只代表部署記錄，未做本輪正式站 GUI |
| 正式 Supabase | project ref `vctisuglfoxyuwlvyjee`、`ACTIVE_HEALTHY` | 未執行任何正式 Migration 或資料寫入 |
| 正式 Migration 版本 | **43** 筆，最新 `20261103212647` | 早期 29 筆資料已過時 |
| GitHub V5.4 工作分支 Migration | **46** 份 SQL：37 份舊版重播＋V4 候選、9 份 V5.1–V5.4 | 開發庫重播檔 **不是** Production 實際版本歷史 |
| 版本號直接對應 | 43 正式版本中僅 **11** 與 GitHub 重播版本號相同；**32** 份未直接匹配 | **未驗證 SQL 語義等價**，不可依檔名跳過或補寫歷史 |
| 正式 V5 Tables | `public`／`tutor_private` 中 **0** 張 `v5_%` 資料表 | 任何新 V5 RPC／UI 在正式環境均未準備好 |
| V4 三張課程／付款表 SELECT RLS | `lesson_records`、`payment_batches`、`payment_batch_items` 的政策可見家長關聯條件 | 僅政策文字唯讀證據，**不等於**實際 JWT／解除關聯攻擊驗收 |
| Supabase Security Advisor | 報告數個 V4 無政策 RLS 表，另有 **19** 個 authenticated 可執行 `SECURITY DEFINER` 函式警告 | 需逐項分析是否為預期受控 RPC；不要機械式撤除權限 |

最新 V4 正式 Migration `20261103212327`–`20261103212647` 已存在於正式版 history，卻不是此 repository 原有 V4 重播時間戳；歷史表不可按名稱強行對齊。舊 `docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json` 仍保留為**歷史快照**，不得覆寫成這次的版本。

## 2. V5 Draft PR 依賴鏈與驗收

| 順序 | PR | 工作邊界 | 上游（Base） |
| --- | --- | --- | --- |
| 1 | [#51](https://github.com/zhichiangai/tutor-app/pull/51) | Free／Pro／Team、終身名額、方案授權 | `main` |
| 2 | [#52](https://github.com/zhichiangai/tutor-app/pull/52) | Team 邀請與專案指派 | #51 分支 |
| 3 | [#53](https://github.com/zhichiangai/tutor-app/pull/53) | Team 學生、課程與 V4 資料隔離 | #52 分支 |
| 4 | [#54](https://github.com/zhichiangai/tutor-app/pull/54) | 課程費用快照與私有稽核 | #53 分支 |
| 5 | [#55](https://github.com/zhichiangai/tutor-app/pull/55) | 管理者人工付款與跨科目部分分配 | #54 分支 |
| 6 | [#56](https://github.com/zhichiangai/tutor-app/pull/56) | 預收、管理者抵扣、月度對帳與 GUI | #55 分支 |

2026-11-06 查證：六份 PR 均 `open + Draft`，堆疊 Base/Head 一致，尚未合併。
- #55 `0fad6a62e30ec1ff2f6a95876d3f43fb771f39f3`：隔離 Chromium 31/31 PASS。
- #56 `f61b18f74fcb57cf45aa25229cdb262723cc1fda`：隔離 Chromium 34/34 PASS、Node／PostgreSQL PASS（[Chromium](https://github.com/zhichiangai/tutor-app/actions/runs/42105785162)、[Node/Postgres](https://github.com/zhichiangai/tutor-app/actions/runs/42105785121)）。
- 本輪**另外新增並發抵扣測試**；以該 Commit 為 Head 時，不能沿用上面 #56 舊 SHA 的 PASS，須等待新 CI 真實完成。

## 3. 安全審查發現：可見的高風險交界

1. **V5.1 不是純粹新表 Migration**：`20261104131300_v5_1_entitlements_student_seats.sql` 會把現有 V4 工作區／學生初始化到授權與名額帳本，並在既有 `public.workspaces`、`public.students`、`public.workspace_members` 新增 AFTER triggers。即使 V5 UI 尚未上線，新增／修改 V4 學生或老師也可能受新名額限制，必須在正式相容性還原庫測 V4 回歸。
2. **V5.2 修改共用權限邊界**：會新增 `public.workspace_members` 的 SELECT policy，並透過授權 RPC 增減該表的 Team 成員。必須測舊老師／家長無法跨工作區看到陌生會員、原 V4 班務不被破壞。
3. **V5.3／V5.4 金額皆走私有表＋可執行 RPC**：使用者端不能直接讀寫 `tutor_private`。各個 `SECURITY DEFINER` RPC 必須逐一檢查 `auth.uid()`、現任 Team 管理者、方案 `team`、學生與課程同 Team、固定 `search_path`、`EXECUTE` grants。
4. **金額守恆**：每筆確認付款＝直接課程分配＋預收；預收原始額＝累計抵扣＋餘額；每堂課應收＝直接付款＋預收抵扣＋未結清。報表的已確認人工付款不得因預收抵扣再次累加。
5. **並發與歷史不可改寫**：同一筆 credit 由兩個不同請求同時抵扣時，總成功金額不得超過餘額；同一 idempotency key 重試不得新增第二分錄；全部透過單一交易與 Team anchor 鎖序列化。
6. **角色與快取**：一般老師／家長／學生／前管理者無權讀寫 Team 財務 RPC，跨 Team 或跨學生不得抵扣；登出、換學生與請求失敗不能繼續顯示舊金額。
7. **可追溯歷史缺口**：V5.4 目前具備私有追加式稽核，但管理者 GUI 主要顯示 credit 餘額與已收付款；完整逐筆抵扣操作歷史、退款、沖銷／更正與家長通知仍未達商業發布範圍。不得宣稱已完成正式帳務後台。

Supabase Advisor 參考：<https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable> 與 <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>。警告是否為實際弱點取決於每個函式的授權條件與政策，不可僅以 Advisor 數量判定 FAIL/PASS。

## 4. 發布前必須取得的具體證據（每項獨立 Gate）

| Gate | 必要證據 | 現況 |
| --- | --- | --- |
| G0 版本凍結 | 六 PR Base／Head，最新 Commit CI，Vercel／Main SHA | PARTIAL：最新開發 CI 仍需重跑 |
| G1 正式唯讀對照 | 43 筆現行歷史、Schema／RLS／RPC 實況、46 份開發檔完整對照 | PARTIAL：只核對版本號與部分權限；**32 個不同版號未證明語義等價** |
| G2 正式備份與隔離還原 | 非對話／非 Git 的加密備份；Auth／課程／付款一致性校驗、可追溯還原演練 | **NOT TESTED**，無法聲稱有備份 |
| G3 相容環境 QA | 在**模擬正式 43 筆 Schema** 的隔離還原庫，逐份應用經審核的 V5 9 份 SQL；核對 V4 trigger、RLS、資料完整性 | **NOT TESTED**：現有 CI 為從零重播開發庫 |
| G4 V5 交易安全 | PostgreSQL/JWT／PostgREST、競爭抵扣、管理權轉讓、V4 零變更、計價與月度對帳 | PARTIAL：CI 合成資料通過部分案例，最新新增測試待驗 |
| G5 人工 GUI | Codex IAB 實際點擊、老師／家長／學生、320／375／390／430 px、登出／換人 | **NOT TESTED**（V5 未發布） |
| G6 發布與回復 | 明確資料庫變更 SQL、版本／feature flag、部署順序、回滾與應變，使用者**另外核准** | **BLOCKED：尚無新一輪正式發布授權** |

## 5. 不能把 PR Merge 直接當成正式發布流程

`main` 連到 Vercel Production。若直接依序合併 #51、#52...，前端可能呼叫尚未建置的 V5 RPC；反過來，**在 UI 發布前套用 V5 SQL 也會啟用 V5.1 對 V4 共用表的 triggers**。

取得 G1–G4 證據後，需先選定以下其中一個可回復策略，再請使用者核准：
- **建議：feature-gated 前端 + 審核過的正式專用增量 Migration**。完成隔離還原與演練後，由使用者分別核准正式 DB 與 Main 發布。V5 UI 保持關閉直到正式 schema／權限確認，再逐步啟用。確認 V4 在每一步都能正常使用。
- 如無 feature gate，就必須設計有維護窗口的 DB／網站協調切換，在寫入 V5 前不得讓真實使用者進入未經驗證流程。

邏輯整合順序始終是 **PR #51 → #52 → #53 → #54 → #55 → #56**。在上游合併後檢查後續 PR 的自動 rebase／Base、重新驗證差異與 CI；不是一口氣合併六個 PR。完整發布 GO 必須逐一證明「正式環境 Migration 兼容」、「現場授權」、「備份還原」、「GUI」，不能以 Preview 或乾淨資料庫 CI 代替。

## 6. 失敗處置與回復

- **未修改正式環境之前**：直接停止 release，保持 Draft／Main／Production 不變；僅在隔離測試庫重新調整 Migration、RPC 或 UI。
- **資料庫 Migration 已開始後**：禁止猜測回復 SQL 或直接倒跑歷史檔；遵照預先演練的正式備份／隔離還原／前進修復方案，保存實際 DDL log、錯誤與 checksum，由使用者另行核准。
- **只發生前端回歸**：若資料庫相容且安全，可使用已確認的 Vercel Production 回滾候選；但**Vercel 回滾不會回滾 Supabase schema 或帳務資料**，必須先確保前後向相容。
- **授權或金額隔離事件**：立即停止財務入口，保留不可變稽核與權限證據，避免自動更正抹除交易歷史。

## 7. 下一次真正可以推進發布的條件

先取得經授權的最新正式備份與隔離還原證據，建立以 43 筆正式 Migration 和現存 Schema 為起點的**正式專用向前 SQL 清單**（不可執行歷史重播），補齊 V5.1 對 V4 觸發器相容性及 RLS/JWT 回歸。由 ChatGPT 整理安全簽核後，請使用者分別決定是否授權正式資料庫變更與合併 Main；正式站 GUI 再由 Codex 實機驗收。

**至此只允許 Draft 文件與安全測試變更，不執行任何正式帳務異動。**
