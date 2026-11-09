# 好好上課 V5.6｜已分配付款退款核准與反向沖帳（開發中）
日期：2026-11-10
範圍：Draft PR #68；正式 Production：NO-GO。

## 本輪 SQL13：P0-A 與 P0-B 的安全基礎
- 第十二份 Migration 的申請仍不會變更任何帳務。
- 第十三份 Migration 新增不可改寫的管理者決定表與逐課程反向分錄。拒絕僅新增決定，不產生分錄。
- 核准 RPC 在現任 Team 管理者、Team 方案與原付款歸屬驗證後，以與既有帳務相同的 anchor workspace row lock，重新計算原分配可退款餘額。
- 同一申請的決定與全部反向分錄同屬單一交易；原付款／原 allocation／歷史稽核不可覆寫。
- 同時核准不同申請時，累計反向分錄不得超過原分配。相同決定與相同理由可重送（冪等）；相反決定與改寫理由拒絕。
- 新管理者專用 `v56_team_direct_refund_net_overview` 區分直接付款「原始分配／反向／淨分配」、應收重新開啟額度、退款應付負債與仍未移動的現金。
- `approved_reversed_pending_manual_payout` 是帳務反向沖帳，不代表已支付退款。回傳 `bank_verified=false`、`manual_paid=false`。

## 仍須完成，不能宣稱 P0 全部完成
- 舊 V5.3/V5.4 `v5_team_payment_overview`、`v5_team_advance_overview`、額度檢查與 UI 目前仍使用原始 gross allocation；它們不是核准反向沖帳後的權威淨帳務來源。需另行更新，避免畫面顯示矛盾。
- 尚未新增已抵扣預收款的反向／退款，以及直接退款人工支付聲明、全時間區間守恆、家長專屬唯讀歷史、正式報表整合。
- 第十三份來源鎖定只是檔案完整性證據；真正正式 43-history 相容重播 A1-R3 仍 BLOCKED。
- 無正式 Migration、RLS/Auth 修改、Production SQL、銀行退款或真實帳號操作。
- 本文件不代表 GitHub CI 已 PASS；必須以 PR 最新 SHA 的 Workflow 實際結果為準。
