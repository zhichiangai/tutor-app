# V3.3 安全檢查｜2026-10-21

本頁說明正式 Supabase `tutor-app` 的 Security Advisor 警告，**不應把警告數量直接當成已確認的漏洞數量**。

## SECURITY DEFINER RPC 的決策

Supabase Security Advisor 的 `authenticated_security_definer_function_executable` 偵測所有已登入角色能呼叫的 SECURITY DEFINER 函式。這類函式可能繞過 RLS，因此必須明確限定其執行者與能處理的資料。

| RPC | 正式 V3.3 用途 | 處理與理由 |
| --- | --- | --- |
| `public.claim_student_invite(uuid)` | 學生用 Google Email 接受老師邀請 | **保留 authenticated**；驗證 Auth UID 與受邀 Email 相符，不接受客戶端自行指定學生身分 |
| `public.shared_course_action(text,uuid,uuid,jsonb)` | 老師、已連結家長與學生操作相同課表 | **保留 authenticated**；每次以 Auth UID 與學生／老師／家長連結做後端驗證，敏感費率從資料庫讀取、付款紀錄受保護 |
| `public.shared_course_history(uuid)` | 查看自己的課程操作記錄 | **保留 authenticated**；由後端限制只查老師或已連結的家長／學生 |
| `public.student_portal_data()` | 學生查詢個人課程與學習回饋 | **保留 authenticated**；只查 `student_links` 允許的學生，不回傳鐘點費／收付款欄位 |
| `public.student_portal_snapshot()` | 先前版本的學生唯讀快照 | **撤銷 authenticated/anon/PUBLIC 的 EXECUTE**；正式 `v2/app.js` 不再呼叫此函式，保留 DB 函式本體供歷史追查 |

上述四個仍使用的函式都必須維持 `anon` **無執行權限**，不可讓 `SECURITY DEFINER` 成為無認證的 API。這些函式應持續做跨學生 IDOR、撤銷邀請、已付款課程、無 session 等對抗測試。

套用 `supabase/migrations/20261021153000_v33_restrict_legacy_student_snapshot.sql` 之後，預期特權函式警告由 **5 → 4**；仍存在的四則是必要 API 的安全稽核待辦，而非可以簡單改成 SECURITY INVOKER 的函式，任意更改可能讓家長和學生失去共同排課權限。

## Leaked password protection

Security Advisor 的 `auth_leaked_password_protection` 表示 Supabase Auth 尚未啟用已外洩密碼檢查（Have I Been Pwned Pwned Passwords API），**此選項不能使用資料庫 SQL migration 設定**。

- 管理員到 [Supabase Auth Email provider](https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee/auth/providers?provider=Email) 查看是否開放 Email／Password 登入。
- 如果使用密碼登入且專案方案支援，啟用 **Leaked Password Protection**。Supabase 官方表示此功能為 **Pro 方案以上**。
- 如果網站只允許 Google OAuth，應確認 Email／Password provider 未意外對外提供，再將此警告註明為與目前登入流程相關性較低；不能宣稱已消除警告。
- 需要網站管理員於後台操作；**目前沒有在程式或資料庫直接切換 Auth 密碼設定**。

官方文件：[Password security](https://supabase.com/docs/guides/auth/password-security)、[Security Advisor](https://supabase.com/dashboard/project/vctisuglfoxyuwlvyjee/advisors/security)。

## 驗收證據與限制

- GitHub Actions：`node --test tests/*.mjs`；必須涵蓋單一星期日期同步、保留多選星期、學生金額隔離、沒有連結的帳號拒絕共同排課。
- Supabase：套用 migration 後重新執行 Security Advisor、檢查五個函式的 `anon`、`authenticated` EXECUTE 權限。
- 跨帳號：必須使用三個**不同且已授權**的 Google 帳號做真正的端對端測試。CI 的 DOM mock 與 SQL 回滾交易只能驗證部分流程，**不能取代真人登入驗收**。
- 涉及資料庫的驗證應使用完整 transaction + ROLLBACK 的臨時測試資料，不得改動真實學生與付款紀錄。
