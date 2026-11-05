-- V5.1 controlled operator console and QA-only seat release.
-- Review as Draft; deploy ONLY after isolated test and explicit release approval.
-- The QA release never deletes current students, course rows, payments or Auth.
alter table tutor_private.v5_student_seat_ledger
  add column is_qa_at_first_seen boolean not null default false;
update tutor_private.v5_student_seat_ledger l
set is_qa_at_first_seen=true
from public.students s
where s.workspace_id=l.workspace_id and s.id=l.student_id and s.is_qa=true;

create or replace function tutor_private.v5_enforce_cumulative_student_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan text; v_bonus integer; v_limit integer; v_used integer;
begin
  if tg_op='UPDATE' then
    if new.id<>old.id then
      raise exception '學生識別碼不可變更，以避免繞過累計名額' using errcode='23514';
    end if;
    if new.workspace_id is not distinct from old.workspace_id then return new; end if;
  end if;
  if new.workspace_id is null then
    raise exception 'V5: student workspace is required' using errcode='23514';
  end if;
  perform 1 from public.workspaces w where w.id=new.workspace_id for update;
  if not found then raise exception 'V5: workspace not found' using errcode='23503'; end if;
  if exists(select 1 from tutor_private.v5_student_seat_ledger
    where workspace_id=new.workspace_id and student_id=new.id) then
    if tg_op='INSERT' then
      raise exception '已刪除的學生識別碼不得重新使用' using errcode='23505';
    end if;
    return new;
  end if;
  select plan_code,extra_student_seats into v_plan,v_bonus
    from public.v5_workspace_entitlements where workspace_id=new.workspace_id;
  if not found then raise exception 'V5: workspace entitlement missing' using errcode='23514'; end if;
  v_limit := (case v_plan when 'free' then 3 when 'pro' then 30
    when 'team' then 100 else 0 end) + v_bonus;
  select count(*)::integer into v_used from tutor_private.v5_student_seat_ledger
    where workspace_id=new.workspace_id;
  if v_used>=v_limit then
    raise exception '已達累計學生名額上限（% / %），請聯絡管理員調整方案或名額',
      v_used,v_limit using errcode='P0001';
  end if;
  insert into tutor_private.v5_student_seat_ledger(
    workspace_id,student_id,is_qa_at_first_seen)
  values(new.workspace_id,new.id,coalesce(new.is_qa,false));
  return new;
end;$$;
revoke all on function tutor_private.v5_enforce_cumulative_student_quota()
  from public,anon,authenticated;

create table tutor_private.v5_qa_seat_release_audit(
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operator_user_id uuid not null,
  released_count integer not null check(released_count>0),
  reason text not null check(char_length(reason) between 10 and 500),
  created_at timestamptz not null default now()
);
alter table tutor_private.v5_qa_seat_release_audit enable row level security;
revoke all on tutor_private.v5_qa_seat_release_audit from public,anon,authenticated;

-- Private SECURITY DEFINER helpers expose no direct browser/API privileges.
create function tutor_private.v5_admin_snapshot_private()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'workspace_id',w.id,'workspace_name',w.name,
      'plan',e.plan_code,'extra_student_seats',e.extra_student_seats,
      'student_used',(select count(*)::int from tutor_private.v5_student_seat_ledger l
        where l.workspace_id=w.id),
      'qa_deleted_eligible',(select count(*)::int
        from tutor_private.v5_student_seat_ledger l
        where l.workspace_id=w.id and l.is_qa_at_first_seen
        and not exists(select 1 from public.students s
          where s.id=l.student_id and s.workspace_id=l.workspace_id)),
      'teacher_used',(select count(*)::int from public.workspace_members m
        where m.workspace_id=w.id and m.role in('owner','admin','teacher')),
      'student_limit',(case e.plan_code when 'free' then 3 when 'pro' then 30
        else 100 end)+e.extra_student_seats,
      'teacher_limit',case e.plan_code when 'team' then 10 else 1 end
    ) order by w.created_at,w.id)
    from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
  ),'[]'::jsonb);
end;$$;
revoke all on function tutor_private.v5_admin_snapshot_private()
  from public,anon,authenticated;
grant execute on function tutor_private.v5_admin_snapshot_private() to service_role;

create function tutor_private.v5_admin_release_deleted_qa_seats_private(
  p_workspace_id uuid, p_expected_count integer, p_operator_user_id uuid,
  p_reason text
) returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; v_deleted integer;
begin
  if p_workspace_id is null or p_operator_user_id is null then
    raise exception 'Workspace and operator required';
  end if;
  if p_expected_count is null or p_expected_count<1 then
    raise exception 'A positive expected count is required';
  end if;
  if char_length(trim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'An audit reason of 10-500 characters is required';
  end if;
  -- Serialize against all V5 seat creations and other admin releases.
  perform 1 from public.workspaces w where w.id=p_workspace_id for update;
  if not found then raise exception 'Workspace not found'; end if;
  select count(*)::integer into v_count
    from tutor_private.v5_student_seat_ledger l
    where l.workspace_id=p_workspace_id and l.is_qa_at_first_seen
    and not exists(select 1 from public.students s where s.id=l.student_id
      and s.workspace_id=l.workspace_id);
  if v_count<>p_expected_count then
    raise exception 'QA count changed: expected %, actual %',p_expected_count,v_count;
  end if;
  delete from tutor_private.v5_student_seat_ledger l
    where l.workspace_id=p_workspace_id and l.is_qa_at_first_seen
    and not exists(select 1 from public.students s where s.id=l.student_id
      and s.workspace_id=l.workspace_id);
  get diagnostics v_deleted=row_count;
  if v_deleted<>v_count then raise exception 'Concurrent QA seat change'; end if;
  insert into tutor_private.v5_qa_seat_release_audit(
    workspace_id,operator_user_id,released_count,reason)
  values(p_workspace_id,p_operator_user_id,v_deleted,trim(p_reason));
  return v_deleted;
end;$$;
revoke all on function tutor_private.v5_admin_release_deleted_qa_seats_private(
  uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function tutor_private.v5_admin_release_deleted_qa_seats_private(
  uuid,integer,uuid,text) to service_role;

-- PostgREST service-role-only wrappers; invoker, not high-privilege browser RPCs.
create function public.v5_admin_snapshot()
returns jsonb language sql security invoker set search_path='' as $$
  select tutor_private.v5_admin_snapshot_private();
$$;
create function public.v5_admin_apply_plan(
 p_workspace_id uuid,p_plan text,p_extra_students integer,
 p_operator_label text,p_reason text
) returns void language sql security invoker set search_path='' as $$
  select tutor_private.v5_admin_grant_entitlement(
    p_workspace_id,p_plan,p_extra_students,p_operator_label,p_reason);
$$;
create function public.v5_admin_release_qa_seats(
 p_workspace_id uuid,p_expected_count integer,p_operator_user_id uuid,p_reason text
) returns integer language sql security invoker set search_path='' as $$
  select tutor_private.v5_admin_release_deleted_qa_seats_private(
    p_workspace_id,p_expected_count,p_operator_user_id,p_reason);
$$;
revoke all on function public.v5_admin_snapshot() from public,anon,authenticated;
revoke all on function public.v5_admin_apply_plan(uuid,text,integer,text,text)
  from public,anon,authenticated;
revoke all on function public.v5_admin_release_qa_seats(uuid,integer,uuid,text)
  from public,anon,authenticated;
grant execute on function public.v5_admin_snapshot() to service_role;
grant execute on function public.v5_admin_apply_plan(uuid,text,integer,text,text)
  to service_role;
grant execute on function public.v5_admin_release_qa_seats(uuid,integer,uuid,text)
  to service_role;
