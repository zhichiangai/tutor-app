# V5.5 正式 Supabase 唯讀審核與 V4＋V5 發布準備（2026-11-08）

> **審核範圍：** 使用者選擇方案 A：完成正式 Supabase Schema、V5 SQL、RLS、重建策略之準備；**不得修改正式 DB，不得合併 Main，不得部署 Vercel**。
> **最新業務決策：** 現有 Auth／課程／學生／帳務均為可捨棄測試資料；不要求歷史資料備份、移轉、還原。這不等於目前授權任何刪除或重建。
> 本報告以本輪 Supabase 連線唯讀查核和 PR #58 原始碼為依據；UI／隔離 CI PASS 不等同真實正式環境測試。

## 1. 決策與建議

**建議方案：保留既有 Supabase Project ref vctisuglfoxyuwlvyjee 及 Google OAuth 設定，建立一套正式專用的 V5-only 向前增量 Migration；不清空整個 Supabase 專案，也不直接把 repo 46 份歷史 SQL db push 至 43 版正式庫。**

原因：
- 目前 V4 核心 Schema 與 RLS 存在。重建 Auth／Storage 等受管理 Schema 會增加不必要的整合風險。
- GitHub 46 份 SQL 包含從零重播用的 37 份 V4/候選基線；正式庫已有不同編號的 43 筆歷史，不能盲目 repair 或重套。
- 新增 V5 的 9 份 SQL 版本皆晚於正式最新版本，但部分修改現存 V4 的表、Trigger、Policy，**尚未在實際 43-history Schema 的隔離副本中測試套用**。
- 組織 rapid4grad 為 Free，現有兩個 ACTIVE_HEALTHY Supabase project；另兩個 INACTIVE。官方 Free 上限為兩個啟用專案。新建第三個不能假定無成本，也不應動其他不相干專案。
- **V4 個人模式、V5 Team 模式共享帳號與底層 workspace 錨點，但學生／課程／付款資料表不同**。切換模式不代表更動角色或取得 Team 權限。

## 2. 正式環境唯讀證據

執行日期：2026-11-08 Asia/Taipei；只使用 Supabase 讀取工具，沒有任何 SQL 寫入。

| 項目 | 實查結果 |
| --- | --- |
| Supabase project | vctisuglfoxyuwlvyjee；ACTIVE_HEALTHY |
| PostgreSQL | 17.11 |
| Migration history | 43 筆，最後 20261103212647（v4_qa_reclassification_guard） |
| public 業務表 | 23 張，23/23 RLS enabled |
| tutor_private 業務表 | 12 張；7 張 RLS enabled，5 張未啟用 RLS；後五張 authenticated 無直接 SELECT |
| V5 表／V5 函式 | 0／0（尚未上正式版） |
| 八張 V4 核心表 | workspaces、workspace_members、profiles、students、student_guardians、lesson_records、payment_batches、payment_batch_items 全部存在，8/8 RLS enabled，anon direct SELECT=0 |
| 現有資料筆數摘要 | Auth users 5、workspaces 4、workspace_members 4、students 5、lesson_records 147、payment_batches 3、payment_batch_items 3（全部依 Owner 確認為測試資料） |
| Free 學生名額相容性 | 目前最多單一 workspace 3 位學生；有 1 個 workspace 正好達 Free 累計上限 |
| Storage | bucket 0；不能由此證明其他外部檔案皆為零 |
| DB pg_cron／pg_net | 未發現 cron.job / net.http_request_queue catalog；不代表外部 GAS／Resend／Vercel 排程不存在 |
| 對外副作用 | 外部 GAS、第三方信件、Google OAuth Provider 與 Vercel 環境變數沒有完成設定核查，發布前需另確認 |

可重複查核之 SQL：`supabase/diagnostics/v5_production_release_preflight_readonly.sql`。它只輸出 Metadata 與筆數，不取得使用者姓名、Email、課程或付款明細。本輪該 SQL **已在正式庫執行一次，PASS（唯讀）**：
- applied_migrations=43、latest=20261103212647、v5_tables=0
- v4_core_tables=8、v4_core_rls=8、v4_core_anon_select=0
- student/workspace/membership 必要欄位=true、workspace_members 複合 PK=true
- Auth=5、V4 學生=5、課程=147、付款批次=3

## 3. RLS／RPC 安全審核

### 3.1 正式 V4

- public 23/23 表均開啟 RLS；本輪檢查沒有 anon 直接讀取這些業務表。
- Supabase Security Advisor：`rls_enabled_no_policy` 10 個 INFO；其中部分為 RLS 開啟但刻意不開放瀏覽器讀取的私有、聯絡或稽核表。不能直接將 INFO 當作安全漏洞，也不可為了清除警告添加泛用 SELECT policy。
- `authenticated_security_definer_function_executable` 19 個 WARN。逐一讀取函式 Metadata：**19/19 公開且 authenticated 可執行的 SECURITY DEFINER RPC 都有固定的空 search_path，且定義中出現 auth.uid()，anon 不可執行**。但只有語法與 grants 證據，不能取代逐一驗證 RLS、管理者或學生關聯的語義。
- `auth_leaked_password_protection` 1 個 WARN；屬 Auth 設定審查事項，不透過 SQL 亂改認證設定。
- tutor_private 中 5 張未啟用 RLS 的業務／稽核表目前沒有 authenticated 直接 SELECT；屬防禦縱深改善候選，需確認 trigger / service 用途後才能加政策或撤除權限。
- 現有 V4 老師／家長／學生、家長解除關聯、學生不顯示金額與已確認收付款功能仍要在正式站重新驗收，不能因 Metadata 查核而宣告 PASS。

### 3.2 九份 V5 SQL 靜態審核矩陣

| Migration | 功能／主要 Schema | 既有 V4 影響／風險 |
| --- | --- | --- |
| 20261104131300_v5_1_entitlements_student_seats | Workspace 方案、個人學生累計名額與私有 audit；Free 3、Pro 30、Team 100 | **會對 public.workspaces、public.students、public.workspace_members 新增 Trigger**。現有 workspaces／students 會被初始化到 V5 名額帳本。個人模式新增學生及 Team 老師名額受影響，須驗收 |
| 20261105171000_v5_1_admin_qa_release | 管理者 audit、服務角色方案／QA 名額控制 RPC | service_role only 的管理函式不能由 authenticated/anon 呼叫 |
| 20261105181500_v5_2_team_projects_invitations | Team Projects、老師指派、邀請與 audit | 在既有 public.workspace_members **加 SELECT policy**；邀請接受透過受控 RPC 更新 V4 membership。核對跨 workspace 及撤權 |
| 20261105192000_v5_2_team_governance_transfer | Team roster、管理者轉讓、治理稽核 | 增修 Team 自己的 policy/RPC；管理者轉讓不應轉移 V4 個人 workspace 的 ownership。需測 JWT 即時撤權 |
| 20261105201500_v5_3_team_data_boundaries | 獨立 Team identity、Team 學生、跨專案 enrollment、lesson | V5 Team 以原個人 workspace 為 anchor；Team 專用學生／課程與 V4 公開表分開；需測身份、跨專案、名額 |
| 20261106031000_v5_3_team_billing_foundation | 私有 Team 應收、費率快照、確認 RPC、帳務 audit | 僅現任管理者可讀／確認財務；舊 V4 個人帳務不得被改寫 |
| 20261106034000_v5_3_partial_payment_allocation | 人工付款、按科目／課程分配、確認 audit | 分配守恆、不得跨 Team／學生、重複確認冪等、不得改動 V4 payment_batches |
| 20261106043000_v5_4_team_advance_credit | 預收款、餘額、抵扣、idempotency、并發防護 | 管理者確認、餘額不可負、同一 credit 並發不可超扣、私有 audit |
| 20261106050000_v5_4_team_monthly_reconciliation | 重寫月度帳務 overview / 人工付款 overview | 月度應收、已收、抵扣不可重複入帳；回歸 V4 老師收款表 |

**Important：** 此矩陣為對九份已提交 SQL 的靜態檢查及原有 CI 佐證；沒有在現有正式庫套用任何一份。

### 3.3 必須明示的「資料獨立，方案共用」耦合

V4 自己的學生在 public.students，Team 學生在 public.v5_team_students；各自的 lessons、payments 不互相寫入。但 V5.1 的 `v5_workspace_entitlements` 鍵是既有 public.workspaces.id；V5.3 Team identity 透過 `v5_teams.anchor_workspace_id` 引用同一個 workspace。V5 的 Team 名額與啟用狀態也讀該 entitlement。

因此目前產品行為是**模式與業務資料隔離，但方案／名額錨點共用**。若日後改成「個人訂閱和 Team 訂閱完全分開」，屬額外產品與資料模型變更；本輪不能把現況寫成已完全分離。

### 3.4 Team 模式可見，不等於 Team 方案已啟用（正式驗收重要關卡）

九份 V5 SQL 的首份會把既有 workspace 的 plan_code 初始化為 **free**；Team 課程、名額與管理功能透過資料庫規則檢查 plan_code='team'。管理員調整方案只能透過 service_role 專用 RPC（例如 public.v5_admin_apply_plan），**不能由老師切換前端模式或在瀏覽器自行授權**。

因此，未來正式資料庫增量 Migration 全部套用後，還要先在受控的後端管理作業中，為**明確指定的合成測試老師工作區**授予 Team 測試方案，留存 audit，再由 Codex 測 Team；測完需規劃恢復／停用測試權限。這個授權尚未執行，且不得把 service_role key 放到前端、GitHub 或聊天記錄。沒有這一步，不能把「Team 選單可點」當成「Team 功能正常」。

## 4. 隔離環境驗收證據（不能推論正式相容）

PR #58 Main 整合候選的上一次測試版本：`8a4de788a0111e695ce3e77f4a64205245915767`

- Node regression：315/315 PASS，Actions #42480426373。
- 隔離 PostgreSQL 契約及 QA：Actions #42480426371、#42480426363，PASS。
- Disposable Supabase：46/46 repo migration，九份 V5 SQL；V5 27 張表 RLS、V4 核心 8 張表 RLS、0 直接 anon exposure、8 組 zero-row 初始資料 PASS。
- 同一 GitHub CI Chromium：38/38 PASS，包含三角色、Team、四種手機寬度，Actions #42480426342。
- **七表 V4 PII-free 結構比對 0 mismatch**，但只覆蓋七表的結構子集合；不代表完整正式 43 筆 Schema 的 Trigger／Function／Policy 語義等價。
- CI 合成資料 selected-schema dump/restore PASS；不是真正 Production 還原（依 Owner 最新決策，正式舊假資料保留與還原不列為開發前提）。

## 5. 兩個可選正式後端方案

### 方案 A1：沿用正式 Supabase，向前增量升級（建議）

1. **不刪 Auth、不重設受管理 Schema**；現有 OAuth、project ref 與 Vercel 網站介接維持原值。
2. 對正式 43-history Schema 做「schema-only / 不含任何學生或帳務資料」的**隔離相容演練**：九份 V5-only SQL 依版號順序施作、每份記錄 hash、RLS/RPC diff、V4 Trigger/學生名額及三角色 JWT 實測。這次尚未完成，不能標 PASS。
3. 將九份 SQL 固化為**正式專用向前增量清單**；不把 37 個 repo 舊版重播 SQL 重新執行到正式庫，不 fake/repair 原本 43 筆 history。
4. 使用者後續如要清空假課程、假帳務或 Auth 測試帳號，須另有**精確表與帳號範圍**的受控清理計畫；資料可捨棄不等於一定要清空才能升級 V5。盲目 TRUNCATE CASCADE／drop public schema 不可採用。
5. 當正式後端擁有 27 張 V5 表及預期 RPC／RLS，完成自查後，才在**另一輪具體發布授權**下合併 Main 的單一整合 PR #58。Vercel Production SHA 要與 Main 一致。
6. Codex 使用正式站的老師／家長／學生測試帳號實際驗收設定切換、月曆、課後紀錄、Team 帳務、管理者撤權與手機 320/375/390/430 px。

**優點**：保留專案 ID、Google OAuth 與部署環境變數，沒有額外 Supabase 專案費用。**缺點**：需要證明當前 43-history Schema 與九份增量 SQL 的兼容性，且清理舊假資料有表間相依性。

### 方案 A2：全新乾淨正式 Supabase（備選，未核准）

- 從 repo 46 SQL 重建，乾淨 Auth；需重新配置 Google OAuth redirect、Vercel 環境參數、Edge/GAS/Storage，所有三角色帳號重新建立並驗收。
- Free 組織目前已有兩個啟用專案；Supabase Free 官方限兩個啟用專案。**不可假設可以免費新增第三個，亦不可碰其他不相關的專案**。若需要額外資源，先取得明確成本與使用者同意。
- 可降低 43 vs 46 歷史不一致的部署風險，但會增加登入與外部設定切換風險。

### 不建議：直接重設現有 Production

- 無論用 remote reset、drop cascade、db push 46 份舊版 SQL、編造 migration history，都可能損壞受管理 Auth／既有安全設定與 V4 的正式路徑。本輪**禁止且未執行**。

## 6. 上線前的不可省略 Gate

| Gate | 要件 | 本輪狀態 |
| --- | --- | --- |
| R0 唯讀正式盤點 | 版本、表、RLS、RPC、Triggers、帳務與 Auth 筆數 | **PASS（Metadata 唯讀）** |
| R1 V5 SQL 靜態審核 | 九份 SQL、權限及對 V4 共用表副作用清單 | **PARTIAL**（完成主要靜態分析；函式所有路徑仍需真實 JWT 回歸） |
| R2 CI 乾淨建置 | 46 SQL、RLS、三角色及 Team E2E | **PASS（隔離 CI）** |
| R3 正式 Schema 相容演練 | 真實 43-history Schema 的無資料隔離副本 → 九份 V5 SQL | **BLOCKED／NOT TESTED**（尚無符合條件的隔離副本） |
| R4 Auth/OAuth／通知整合 | Google、登入回呼、GAS/Resend 等外部副作用核對 | **PARTIAL**（僅檢查資料庫與 Edge Function Metadata，Dashboard/外部整合未完整確認） |
| R5 正式 DB 變更 | 精確 SQL、順序、回滾或向前修復方案，當次明確授權 | **NOT AUTHORIZED** |
| R6 Main／Vercel Production | PR #58 Main 合併與 READY SHA 核對 | **NOT AUTHORIZED** |
| R7 Codex 正式 GUI | 三角色、Team 資料隔離與手機尺寸 | **NOT TESTED** |

> 不要求保留舊測試資料，不代表資料庫安全與授權測試可以省略。

## 6.5 2026-11-08 補充：正式 OAuth／通知與完整 V4 結構指紋（唯讀）

本節是 2026-11-08 最新追加的實查證據，未修改任何 Production 設定。

- 正式 `auth.identities` 以 **provider 分組筆數**查詢：`google=5`；不讀取姓名、Email 或其他身分內容。這確認資料庫存在 Google 登入身分關聯，**不能直接證明 Google OAuth Console／Supabase Provider、Redirect URL 的現行設定正確**。
- Vercel `tutor-app-v2` Production 的環境變數**僅讀取鍵名、型別和 target**，已確認 `V4_PRODUCTION_SUPABASE_PROJECT_REF`、`V4_PRODUCTION_SUPABASE_URL`、`V4_PRODUCTION_SUPABASE_PUBLISHABLE_KEY` 三項，均為 production encrypted。沒有讀取、列印或變更任一值；因此尚未完成值與運作狀態驗證。
- `api/v4-config.js` 要求 Production hostname 與固定專案 ref 相符；`v2/app.js` Google OAuth 導回同一站的 `/v2/index.html`。這是**程式碼靜態條件**，不是實際 Google 登入 PASS。
- `api/v5-admin.js` **刻意限制於 preview + isolated**，且需要 operator allowlist 和 service key。不能以此前端／API 在正式站直接調整 Team 方案；未來的正式 Team QA 方案授予須單獨規劃、保留 audit 並另行授權，不能把 service_role 鑰匙移到瀏覽器。
- 正式 Supabase `list_edge_functions` 未列出任何已部署的 Edge Function；GitHub `supabase/functions/v4-gas-bridge` 與 GAS 通知程式明確設定為 isolated/staging-only。**通知整合的正式部署與對外寄信功能不能判定 PASS**；不應為了這項驗收在未授權下發送測試信。
- Supabase Branch read-only list 只有正式 `main`，沒有既有的可直接使用的正式 Schema 隔離分支。
- [完整 V4 Production Metadata 指紋](./catalog/PRODUCTION_V4_43_SCHEMA_FINGERPRINT_20261108.json) 取自正式庫（35 tables／287 columns／192 constraints／117 indexes／56 policies／27 triggers／54 functions），物件定義僅儲存雜湊，不含任何個資或付款資料。[同版唯讀 SQL](../../tests/sql/v5_production_schema_fingerprint_readonly.sql) 已在 Production 重跑，七類結果與快照**逐項一致**。
- GitHub CI 加入 `tests/local/v5-production-schema-fingerprint-compare.mjs`：僅比較已封存的 V4 結構指紋與 disposable CI 上的 V4＋V5 結果，**不讓 CI 連接正式庫**；新增 V5 物件允許作為 additions，既有 V4 物件缺漏／內容變更列入 Release NO-GO 診斷。**即使這項指紋比對 PASS，也只能證明 Metadata 相容，不能取代實際以 43-history Schema 對九份 V5 SQL 的隔離施作。**

## 7. 下一步交接

- **目前只需完成 A1 的 R3 正式 Schema 相容演練和外部 Auth/OAuth 設定檢查。** 不要重做 46 份 CI clean replay，不要修復 GitHub migration history 編號。
- 成立可驗證、**無學生資料**的正式 schema-only 相容測試庫；逐份套用九份 V5 SQL，記錄失敗精確行、RLS 權限差異與 V4 名額干擾。如果無法從工具取得完整 Schema，只能標記 R3 BLOCKED，不能宣稱「正式相容已 PASS」。
- 完成後由 ChatGPT 提出正式變更清單和界線，另取得資料庫變更及 Main 合併的明確授權，再交給 Codex 驗收正式站。
- 目前 Main/Production 維持原 V4；不要為了製造一個可截圖的 V5 介面就先合併前端。

## 8. 參考與證據來源

- GitHub Draft PR #58：https://github.com/zhichiangai/tutor-app/pull/58
- CI 38/38：https://github.com/zhichiangai/tutor-app/actions/runs/42480426342
- CI 315/315：https://github.com/zhichiangai/tutor-app/actions/runs/42480426373
- Supabase docs deployment migrations：https://supabase.com/docs/guides/deployment/database-migrations
- Supabase docs managing environments：https://supabase.com/docs/guides/deployment/managing-environments
- Supabase Free active projects：https://supabase.com/docs/guides/platform/billing-faq
- Advisor lint 0008：https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Advisor lint 0029：https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

**這份報告只有唯讀 metadata 與源碼分析，沒有機密資料、Token 或帳密。**
