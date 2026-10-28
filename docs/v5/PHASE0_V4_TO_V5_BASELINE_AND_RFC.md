# 好好上課 V4 → V5｜Phase 0 已查核基線與擴充架構 RFC

> 建立日期：2026-10-29（Asia/Taipei）。此文件是可審查的開發基線，不是正式發布授權，也不是已完成的 V5 功能。正式資料／帳務未修改。每次準備發布仍須重新查核實際狀態。

## 一、目標與不變條件

先穩定 V4 的付款安全、QA 帳務及三角色功能，再以相容性擴充開始 V5.0。沿用既有 V4 UI、登入身分、學生／課程原始 ID、工作空間及付款歷史；不重寫網站、不直接套 V5 Migration、不在 Production 上測試假資料。

工作分工：**ChatGPT/程式端** 核查 GitHub、資料庫、RLS、Migration、CI 與規格；**Codex/內建瀏覽器端** 只以實際點擊和畫面證據驗收 UX、導覽、資料顯示與 Network；兩邊結果交叉比對，不讓兩邊重複做相同靜態審查。

## 二、實際查核結果（2026-10-29）

| 項目 | 已查核事實 | 門檻 |
| --- | --- | --- |
| Production DB | Supabase project vctisuglfoxyuwlvyjee，29 筆 Migration；最後 20261022110047 | V4 增量與 rollback／restore 尚未發布與驗證 |
| Workspace | public.workspaces 含 id,owner_id,name,kind；workspace_members 含 workspace_id,user_id,role | V5 應擴充現有模型，不替換 workspace ID |
| 課程 | lesson_records 已有 workspace_id、student_id、owner_id；但同表亦有 hourly_rate、total_amount | V5 非財務授課老師不可直接讀取含費用欄位的基礎表 |
| 付款 | payment_batches、payment_batch_items 正式存在；付款更正兩表及 V4 QA 標記表尚不存在 | V4 更正與分類仍不可在正式站當作可用 |
| 學生 | 正式 public.students 尚無 is_qa 欄位 | 不得憑備註文字或模糊學生分類自動排除收款 |
| 正式付款 SELECT RLS | payment_batches、payment_batch_items、family_requests 家長 SELECT 尚未加有效 student_guardians 關聯限制 | **P0** 修補前不得宣稱解除關聯後付款隱私安全 |
| Edge Function | 正式 Project Edge Functions = 0 | GAS 已做單次實際寄件，但 Queue/ACK 串接未驗收 |
| PR #37 | Draft、未合併：付款 RLS hotfix 候選＋GAS gateway 設定；三套既有 CI PASS | hotfix 本身須隔離執行及回滾證據 |
| PR #38 | Draft、未合併：根入口 V4/V1 兼容修正；V3 Regression PASS | 發布前確認正確的網站入口 |
| PR #39 | Draft、未合併：空白 Preview 可導覽不可寫入、付款月份修正；V3 Regression PASS、隔離 Supabase Auth Workflow FAIL | Preview UI 已經瀏覽器核對，但有資料帳務與 OAuth 尚未 E2E |
| PR #40 | Draft、未合併：單筆付款 QA 標記／稽核候選；V3 Regression + PostgreSQL Contract PASS、隔離 Auth Workflow FAIL | 未進正式 Migration、未接前端總額；舊式單堂已收款尚未涵蓋 |

CI 成功的結論僅屬執行過的特定測試；失敗／未執行的隔離 Auth 或真實瀏覽器測試不得標為 PASS。Codex 已完成無資料 Preview 的操作驗收，不應重測相同空白畫面。

## 三、V4 發布前的 P0 工作序列

1. **權限：** 審查 PR #37 與 v359_parent_payment_link_rls.sql，確認家長原關聯、解除關聯、不同教師、不同 workspace、匿名與學生之 JWT/REST 行為；在隔離資料庫實際套用候選 SQL（不等於 Production 已套用）。準備正式備份與復原方案，並取得正式套用授權。
2. **帳務：** 分清 QA 測試學生、真實學生名下的 QA 付款批次，以及未經付款批次的舊式單堂「老師已收到」。PR #40 只提供批次層級候選，**不可單獨發布當作 QA 總額已修好**。確定分類／撤銷分類有老師審查、可追溯稽核、付款歷史不被覆寫，並驗證所有首頁、老師帳務、期間歷史使用一致的統計口徑。
3. **版本：** 比對正式 29 筆 Migration 與 GitHub V4 候選，制定向前相容、可回滾的 Migration 順序，不使用 migration repair 填補尚未執行的 Migration，也不從兩個 Draft PR 的 SQL 盲目拼接。
4. **測試：** 隔離 Auth／JWT／RLS，三角色老師／家長／學生 E2E，付款回報／確認／更正與退出後存取權；通過後再進行 Preview 的真實有資料操作驗收。
5. **發布：** 需新鮮且可還原的備份證據、版本 SHA、無 P0 資安／帳務阻礙、使用者核准，才允許合併與正式 Migration。

**最小可交付：** 穩定的 V4 Beta，不強迫在此階段啟用完整 GAS 排程；未完成通知必須明確停用及說明功能限制。整個 V4 Beta 仍應保留老師、家長與學生的實際資料權限驗證。

## 四、V5 產品約束（沿用已核定完整 V5 規格）

| 方案 | 每月費用 | 累計學生上限 | 老師席位 | Team／多專案 |
| --- | ---: | ---: | ---: | --- |
| Free | NT$0 | 3 | 1 | 不支援 |
| Pro | NT$99 | 30 | 1 | 不支援 |
| Team | NT$399 | 100 | 10（含管理者） | 支援 |

Free、Pro、Team 的基本課表與學費功能相同；家長與學生免費。Pro/Team 初期只顯示「即將推出」，不可下單、扣款或建立假的訂閱帳。平台管理員可在安全後端給予容量／期限覆寫並留稽核，但管理權不意味可任意查看學生或付款個資。

一位老師可保留其個人空間並加入多個 Team；資料不自動共享。跨專案同一 Team 的學生只占一個**累計**名額，封存／畢業不能釋出，合法刪除個資後需設計合規且最小化的計數方法。容量檢查由後端以鎖或等價的交易序列化保護，避免並行突破上限。已達上限不阻斷既有教學、付款或歷史讀取。

## 五、建議的 V5 資料模型（RFC，不是已實作）

**A. 授權／容量**

- workspace_entitlements：workspace_id、plan、有效起迄、擴充學生席位／老師席位、版本／狀態；僅可信任的管理後端可寫。
- workspace_entitlement_audit：變更前後值、操作者、原因與期限；append-only。
- workspace_student_registry：工作空間內 canonical student 關聯與單次歷史容量計數，不以單堂課、科目或專案重複計數；對合法刪除資料另設計非識別性的容量紀錄。
- 老師席位沿用 workspace_members 的有效成員，Team roles 另加管理者／授課老師權限，不以 Google 帳號是否登入決定付費資格。

**B. Team／專案**

- workspace_projects：隸屬既有 workspace_id、名稱、狀態；專案不是另立一個收費 workspace。
- project_teacher_assignments、project_student_enrollments：可撤銷且有生效期間的授課及學生指派。同一 student_id 跨專案不重複占容量。
- 必須保留 V4 lesson_records 的原始 ID 與紀錄；增量增加 project_id / teaching_assignment 關聯，避免範圍外課程被讀取或重複記帳。
- Team 管理者轉讓須由接任者同意並在單一資料庫交易內換權；退出後舊 JWT 不能繼續讀 Team 資料。

**C. V5 最重要的資料安全斷點**

目前 lesson_records 同時包含課程與 hourly_rate/total_amount。V5 的一般 Team 授課老師只應看到其授權課程，**不可從 SELECT *、REST、RPC、joined view 讀到金額**。光在 UI 隱藏費用或靠同一表的 row-level RLS 不足。設計階段需選定向前相容的資料分層：例如受控課程 projection＋另行權限隔離的 charge／finance 表，並同步處理既有客戶端讀取相容性。**此項經隔離 RLS/JWT 驗證之前，不要開放 Team 實際授課。**

**D. 帳務（V5.1，必須與 V4 相容）**

統一區分：應收學費、家長回報、實際確認入帳、科目／課程分配、預收款、預收款抵扣、退款、更正／沖銷及通知。使用同一帳務真相來源，不得建立兩套互不一致的收款餘額。

家長可回報全部／部分／指定科目；未指定由 Team 管理者分配；管理者核對實際入帳後直接生效，家長收到分配與更正歷史。超收款可經管理者確認建立「同 workspace＋同學生」預收款；系統可以建議抵扣但**只有管理者核准後正式抵扣**。外部退款由管理者確認已實際執行後才登帳。抵扣非新現金收入，退款與抵扣的並發請求不得使餘額負數。

需要業務鍵唯一性、可重算的帳務流水、不可任意覆寫的異動歷史、交易鎖與重試冪等性。這些是**設計目標**，不是本階段已具備的功能。

## 六、遷移與安全測試策略

**Expand → Backfill（合成／隔離）→ Verify → Cutover → Monitor**，不在首個 V5 PR 刪改舊表或立即把所有讀取路徑切到新 Schema。

V5.0 第一個正式程式開發階段應為方案＋容量＋安全管理員授權，且先建立工作空間歸屬／授權單元測試，再新增 DB 約束和 RLS；Team 邀請、多專案、統一帳務依序拆分 Draft PR。

| 驗收案例 | 結果標準 |
| --- | --- |
| V4 付款 RLS | 解除家長連結後，原學生付款及家庭申請查不到；老師歷史權限符合政策 |
| V4 QA | 測試收款不進正式已收總額；真實收款不被錯誤排除；歷史及更正可追溯 |
| V4 角色 | 真實隔離的老師／家長／學生各自登入，同步與登出清空通過 |
| V5 容量 | Free 第 4 位、Pro 第 31 位、Team 第 101 位學生以及第 11 位老師均被後端阻擋 |
| V5 去重 | 同一 workspace 學生／老師跨多專案只算一次 |
| V5 Team 權限 | 授課老師不可見財務數字（含 REST/API）；退出立即失去資料讀取權 |
| V5 帳務 | 部分付款、分配、更正、超額預收、抵扣、退款、併發與重試皆不重複記帳 |
| V5 通知 | 只通知有權家長，失敗重試不能改變帳務交易結果 |

## 七、專案分工與下一步

**ChatGPT／程式審查端：** 持續審查 PR #37–40、SQL/RLS、CI、Migration、Schema 及差異；提出安全修補且附自動化證據。**Codex／內建瀏覽器端：** 只驗證已部署 Preview 的真實畫面與互動，回報操作路徑／預期／實際／是否寫入；無隔離後端時不得把空白畫面視為有資料 E2E PASS。

**下一個實際工程步驟：** 完成 V4 P0 QA 帳務口徑＋付款 RLS 的隔離執行驗證，再取得一套不連正式資料庫的合成帳號 E2E 環境。完成核心 V4 Beta 發布門檻後再開始 V5.0 Schema Migration。不要現在直接啟動 V5 Team 的 Production Migration。

**尚未確認、不得代替使用者做不可逆決定：** 跨 Team 個人資料／歷史容量刪除方案、未入帳 QA 舊交易如何逐筆定性、更正帳務的撤銷權、Team 無人接任管理者的例外機制，以及實際 SaaS 金流開始時點。
