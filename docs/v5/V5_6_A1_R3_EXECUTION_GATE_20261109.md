# 好好上課｜V5.6 + A1-R3 隔離相容與帳務安全開發閘門（2026-11-09）

**結論：NO-GO／開發進行中。** 本文件不是 Production Migration、RLS、Auth、寄信、真實轉帳或 Main 合併授權。

## 本批次實際範圍

- 開發來源：Main `12a7464497170575d8c9bf092597dbccc9e92f29`，新 Draft PR #68；不重用舊 Draft PR 或覆寫原九／十份來源鎖定。
- 原 V5.1–V5.7 **十份 SQL** 保留原始 bytes；新獨立第十一份 `20261109163000_v5_6_team_refund_correction_ledger.sql`。
- V5.6 此階段提供：待確認付款 append-only 沖銷註記、已確認付款的付款方式／備註 append-only 更正、同 Team 同學生 **未抵扣預收款**退款申請／核准／人工付款確認事件。
- 已確認原始付款、直接付款課程分配、預收抵扣與應收快照不得原地修改或刪除；更正與退款歷史保存在私有 RLS 表，只供**現任 Team 管理者**經 RPC 查詢。
- 預收退款核准後須從後續抵扣可用額扣除；與原 V5.4 抵扣共用 Team 錨點工作區鎖，防止重複使用。
- `manual_paid` 只是管理者**自行登記已完成的人工退款**；回傳 `bank_verified=false`，絕對不聲稱已連動銀行、金流或自動退款。

## 尚未完成，不得標 V5.6 全部 PASS

1. 已分配到課程的**已確認**直接付款或預收抵扣之更正／沖銷／退款（需設計 net-settlement、重開應收與守恆，不能把既有 allocation 當成可刪資料）。
2. 家長僅讀自己孩子的更正與退款歷史、跨家庭驗證；學生不得見任何金額。
3. 對外通知、銀行回單／人工對帳證據、管理者完整互動 GUI 及真正金流退款（非本批次側錄）。
4. 真實 Production 43-history Schema-only 兼容重演與逐權限真 JWT 測試。
5. 正式環境授權與發布回復演練。

## A1-R3 真實 43-history 隔離演練

目前 Production Supabase `vctisuglfoxyuwlvyjee` 已有 **43 筆 Migration**，末版 `20261103212647`；正式 `v5_*` 物件為 0。專案當前無已核實的獨立分支。

**本輪實際呼叫 Supabase 建立開發分支** `qa-v56-a1r3-schema-only-20261109`，服務要求先取得**付費確認 ID**；尚未取得使用者同意，**未建立分支、沒有產生成本或變更正式 Schema**。A1-R3 維持 BLOCKED。

即使未來建立 Supabase Branch，工具會重放正式 migration；**不可只因成功建立，就假設與真實 43-history Schema 完全等價**。必須先執行以下 Gate：

| Gate | 最低 PASS 條件 |
| --- | --- |
| R3-1 範圍 | 環境為獨立 branch ref，不能是正式 `vctisuglfoxyuwlvyjee`；沒有學生、課程、付款、Auth 個資／真實 Session；明確啟用停損 |
| R3-2 基線 | 唯讀核對 43 筆 history、最新版本、V4 核心八表與 Policy/Trigger/RPC/grants；比對 `docs/v5/catalog/PRODUCTION_V4_43_SCHEMA_FINGERPRINT_20261108.json` 與 `PRODUCTION_V4_43_FUNCTION_COMPONENTS_20261108.json`，不符即 FAIL-CLOSED |
| R3-3 重放 | 使用獨立新十一份 source lock，逐份按 version 執行；每份寫出 SHA／耗時／成功／失敗停損資訊；不能覆寫原九份或十份來源證據 |
| R3-4 V4 回歸 | V4 三角色、家長解除關聯後查帳、已確認付款鎖定、八表 RLS、RPC 語義與 service_role 權限不被 V5 更動破壞 |
| R3-5 Team RLS／JWT | 現任／前任 Team 管理者、一般老師、家長、學生、跨 Team 與跨學生，均用實際合成 GoTrue/JWT + PostgREST 證明拒絕越權；private 金額表無直接 browser 權限 |
| R3-6 金額不變量 | 付款分配 + 預收抵扣不超應收；已核准退款保留的額度不可再抵扣；多次 retry 不複扣；退款未核准不能標人工已付；已確認原始紀錄不被更新／刪除 |
| R3-7 回復 | 只在無個資隔離環境演練 SQL 故障回滾及失敗停止，確保無半筆退款／部分分配；不得以 reset Production 或修改 history 當回復 |
| R3-8 外部服務 | OAuth、GAS/Resend 與真實銀行外部副作用不參與此 replay；另有 R4 發布驗收閘門 |

### 可使用的既有 CI 範圍

`v4-browser-e2e.yml` 透過 `supabase db reset --local --no-seed` 在本機 disposable PostgreSQL + GoTrue 重放 GitHub repository migration，並包含隔離 Chromium。這能測**乾淨 repo schema**，**不能證明**真實 43-history 的 Schema-only replay；不可將其結果改稱 A1-R3 PASS。

十一份 source lock：`docs/v5/catalog/V5_A1_ELEVEN_MIGRATION_SOURCE_LOCK_20261109.json`。原九／十份檔案內容及歷史 JSON 不可修改。

## 最小風險發布順序（後續另行批准）

1. PR #68 先通過 Node、SQL 可套用性、GoTrue/JWT、Chrome 隔離 E2E；不能只有靜態文字 PASS。
2. 補齊已分配款項之更正／退款守恆、家長授權讀取及管理者 GUI。
3. 經費同意後建立獨立 43-history Schema-only 環境並完成 R3-1 至 R3-7；不合格就修正分支與 SQL，再跑。
4. 具體列出十一份 Migration 回復、停損、正式套用計畫和 R4 外部設定；取得使用者單次**明確** Production SQL 授權。
5. 套用後核對 Schema/JWT，再取得單獨 Main 及正式 GUI 發布授權。

**截至本文件撰寫：A1-R3 BLOCKED，V5.6 PARTIAL，Production 一律 NO-GO。**
