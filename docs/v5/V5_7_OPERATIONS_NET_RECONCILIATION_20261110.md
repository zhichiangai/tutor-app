# V5.7 Team 營運報表淨額整合｜2026-11-10

## 適用範圍

本設計只在既有 [Draft PR #68](https://github.com/zhichiangai/tutor-app/pull/68) 的開發分支驗證。**不代表正式站已啟用 V5，也沒有授權 Production Migration、Main merge、正式付款、實際銀行退款或對外通知。**

本輪新增第 **19 份** V5 forward SQL：

`supabase/migrations/20261110100000_v5_7_team_operations_net_reconciliation.sql`

既有第 9 至 18 份的 SQL 與 source-lock 不改動，新的精確來源鎖定：
`docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json`。

## 問題

舊 `public.v5_team_operations_overview(uuid,date)` 各專案未結清金額仍將原始直接付款分配、預收款抵扣的總額視為已結清。第 13 至 18 份 Migration 已支援管理者核准反向沖帳後，此舊讀模型便可能低估未結清應收，與新的 `v5_team_payment_overview`、`v56_team_conservation_overview` 不一致。

## 修正

- 以相同參數及 current Team manager + plan entitlement 權限重新定義 V5.7 的唯讀 RPC，不動原始 SQL。
- 每個專案獨立彙總：
  - `confirmed_receivable_cents`：已確認應收，不因退款覆寫；
  - `direct_net_cents`：直接付款分配額減去已核准的追加式反向分錄；
  - `advance_net_cents`：預收抵扣額減去已核准的追加式反向分錄；
  - `outstanding_cents`：應收減直接付款淨額及預收抵扣淨額。
- 保留既有 teachers、projects、recent_activity、status、月份與匯總欄位。新增 `ledger_basis='net_after_immutable_reversals'`；`cash_verified_by_bank=false` 不變。
- 管理者前端必須驗證 Team／月份／幣別／管理者授權，及各專案守恆：
  `receivable = direct_net + advance_net + outstanding`。
- 前端額外核對各專案應收合計與 `v5_team_billing_overview.confirmed_total_cents`、各專案未結清合計與 `v5_team_payment_overview.outstanding_cents`；對不上則不顯示專案金額，以避免舊 gross RPC 造成錯誤報表。

## 測試

Node 靜態契約驗證新版 SQL 不再使用原始 gross 聚合、檢查管理者權限／淨額來源標記及 19 份 Git blob SHA。隔離 E2E 使用合成 GoTrue JWT、PostgREST 測試在核准直接付款退款及已抵扣預收款退款之後，將各專案金額與 Team 月度帳務比較，並確認前任管理者、學生無法閱讀。

**所有結果仍以最新 HEAD 的 CI 執行證據為準。** 存在歷史 V4 Production 43 筆 migrations 與 Repository fresh bootstrap 的差異，正式 A1-R3 真實 43-history schema-only replay 尚未完成，正式 V5 發布維持 **NO-GO**。Codex 正式站 GUI 未在此開發階段驗收。
