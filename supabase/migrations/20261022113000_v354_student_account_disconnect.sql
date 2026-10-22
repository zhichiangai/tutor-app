-- V3.5.4: make "disconnect student login" revoke actual row access atomically.
-- The older student_invitations row is the FK parent of student_links.
-- A DELETE only from student_invites does NOT revoke an accepted login.
-- SECURITY INVOKER: caller's existing table grants + row-level policies apply.
create or replace function public.revoke_student_account_connection(
  p_student_id uuid, p_email text
) returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_teacher uuid := auth.uid();
  v_email text := pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_email,'')));
  v_removed_current integer := 0;
  v_removed_legacy integer := 0;
begin
  if v_teacher is null then
    raise exception '請先登入老師帳號';
  end if;
  if v_email = '' or pg_catalog.length(v_email)>254 then
    raise exception '請提供有效的學生邀請 Email';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id=p_student_id and s.teacher_id=v_teacher
  ) then
    raise exception '找不到有權管理的學生';
  end if;

  -- Both DELETE operations are within one PostgreSQL transaction.
  -- Delete the modern invite to prevent a revoked user from re-claiming.
  delete from public.student_invites si
  where si.student_id=p_student_id and si.teacher_id=v_teacher
    and pg_catalog.lower(si.email)=v_email;
  get diagnostics v_removed_current=row_count;

  -- The FK student_links(invitation_id) ON DELETE CASCADE deletes the
  -- actual user/student link and takes away private lesson access.
  delete from public.student_invitations si
  where si.student_id=p_student_id and si.teacher_id=v_teacher
    and pg_catalog.lower(si.email)=v_email;
  get diagnostics v_removed_legacy=row_count;

  if v_removed_current+v_removed_legacy=0 then
    raise exception '這位學生的邀請或連結已不存在，請重新整理';
  end if;
end;
$$;

revoke all on function public.revoke_student_account_connection(uuid,text) from public, anon;
grant execute on function public.revoke_student_account_connection(uuid,text) to authenticated;
