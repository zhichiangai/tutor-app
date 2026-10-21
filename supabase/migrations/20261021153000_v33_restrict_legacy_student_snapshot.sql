-- V3.3 security audit 2026-10-21.
-- student_portal_snapshot() is a legacy duplicate of student_portal_data().
-- The current v2/app.js calls student_portal_data(), never the legacy snapshot.
-- Remove client EXECUTE instead of dropping the function, retaining historical DB compatibility.
revoke all on function public.student_portal_snapshot() from PUBLIC, anon, authenticated;
comment on function public.student_portal_snapshot() is
 'Legacy V3.2 compatibility only, no longer available through authenticated Data API. Use student_portal_data().';

-- The four remaining SECURITY DEFINER RPCs are intentional user-facing capabilities.
-- Ensure none is anonymously invokable, and grant only signed-in accounts EXECUTE.
revoke all on function public.claim_student_invite(uuid) from PUBLIC, anon;
revoke all on function public.shared_course_action(text,uuid,uuid,jsonb) from PUBLIC, anon;
revoke all on function public.shared_course_history(uuid) from PUBLIC, anon;
revoke all on function public.student_portal_data() from PUBLIC, anon;

grant execute on function public.claim_student_invite(uuid) to authenticated;
grant execute on function public.shared_course_action(text,uuid,uuid,jsonb) to authenticated;
grant execute on function public.shared_course_history(uuid) to authenticated;
grant execute on function public.student_portal_data() to authenticated;

-- Do not change end-user passwords or auth settings in a database migration.
-- Leaked password protection is controlled under Supabase Auth > Providers > Email
-- and requires checking the project's billing-plan availability.
