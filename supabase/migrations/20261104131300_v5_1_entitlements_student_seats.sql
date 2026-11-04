-- V5.1 entitlement and cumulative-seat foundation.
-- Apply ONLY in a disposable V5 backend until the separate release gate.
-- V4 business rows, RLS rules, and existing RPCs are intentionally untouched.
create schema if not exists tutor_private;

create table public.v5_workspace_entitlements (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_code text not null default 'free'
    check (plan_code in ('free','pro','team')),
  extra_student_seats integer not null default 0
    check (extra_student_seats between 0 and 100000),
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.v5_workspace_entitlements enable row level security;
revoke all on public.v5_workspace_entitlements from public, anon, authenticated;
grant select on public.v5_workspace_entitlements to authenticated;
create policy v5_entitlement_owner_or_admin_read
  on public.v5_workspace_entitlements for select to authenticated
  using (
    exists(
      select 1 from public.workspaces w where w.id=workspace_id
        and (w.owner_id=(select auth.uid()) or
          exists(select 1 from public.workspace_members m
            where m.workspace_id=w.id
              and m.user_id=(select auth.uid())
              and m.role in ('owner','admin')))
    )
  );

-- Never FK student_id to public.students here: deleting a student must not
-- release a historically consumed seat. The seat belongs to the workspace.
create table tutor_private.v5_student_seat_ledger (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  student_id uuid not null,
  first_seen_at timestamptz not null default now(),
  primary key(workspace_id,student_id)
);
alter table tutor_private.v5_student_seat_ledger enable row level security;
revoke all on tutor_private.v5_student_seat_ledger from public, anon, authenticated;

create table tutor_private.v5_entitlement_grant_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  before_plan text not null,
  after_plan text not null,
  before_extra_students integer not null,
  after_extra_students integer not null,
  operator_label text not null check (char_length(operator_label) between 2 and 120),
  reason text not null check (char_length(reason) between 5 and 500),
  created_at timestamptz not null default now()
);
alter table tutor_private.v5_entitlement_grant_audit enable row level security;
revoke all on tutor_private.v5_entitlement_grant_audit from public, anon, authenticated;

-- Existing workspaces and students are grandfathered: no historical rows are
-- deleted even when their current usage exceeds Free. Only NEW seats are gated.
insert into public.v5_workspace_entitlements(workspace_id)
select id from public.workspaces on conflict (workspace_id) do nothing;
insert into tutor_private.v5_student_seat_ledger(workspace_id,student_id,first_seen_at)
select workspace_id,id,created_at from public.students
on conflict (workspace_id,student_id) do nothing;

create function tutor_private.v5_seed_workspace_entitlement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.v5_workspace_entitlements(workspace_id)
  values(new.id) on conflict (workspace_id) do nothing;
  return new;
end;$$;
revoke all on function tutor_private.v5_seed_workspace_entitlement() from public,anon,authenticated;
create trigger zz_v5_seed_workspace_entitlement
after insert on public.workspaces for each row
execute function tutor_private.v5_seed_workspace_entitlement();

-- Trigger is AFTER the V4 workspace-assignment trigger, so the final workspace
-- is checked. Serialize quota checks on the workspace row (concurrent INSERT).
create function tutor_private.v5_enforce_cumulative_student_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan text; v_bonus integer; v_limit integer; v_used integer;
begin
  if tg_op='UPDATE' then
    if new.id=old.id and new.workspace_id is not distinct from old.workspace_id then
      return new;
    end if;
  end if;
  if new.workspace_id is null then
    raise exception 'V5: student workspace is required' using errcode='23514';
  end if;
  perform 1 from public.workspaces w where w.id=new.workspace_id for update;
  if not found then raise exception 'V5: workspace not found' using errcode='23503'; end if;
  if exists(select 1 from tutor_private.v5_student_seat_ledger
    where workspace_id=new.workspace_id and student_id=new.id) then return new; end if;
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
  insert into tutor_private.v5_student_seat_ledger(workspace_id,student_id)
    values(new.workspace_id,new.id);
  return new;
end;$$;
revoke all on function tutor_private.v5_enforce_cumulative_student_quota() from public,anon,authenticated;
create trigger zz_v5_student_seat_guard
after insert or update on public.students for each row
execute function tutor_private.v5_enforce_cumulative_student_quota();

-- Team teacher seats include the owner; unlike students, count CURRENT members.
-- V4 only creates one owner membership per individual workspace.
create function tutor_private.v5_enforce_teacher_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan text; v_limit integer; v_used integer;
begin
  if tg_op='UPDATE' and new.workspace_id=old.workspace_id
    and old.role in ('owner','admin','teacher') then return new; end if;
  perform 1 from public.workspaces w where w.id=new.workspace_id for update;
  if not found then raise exception 'V5: workspace not found' using errcode='23503'; end if;
  select plan_code into v_plan from public.v5_workspace_entitlements
    where workspace_id=new.workspace_id;
  -- During V4's initial owner membership AFTER INSERT trigger, the entitlement
  -- may not yet have been seeded; it is safely treated as Free (one teacher).
  v_limit := case coalesce(v_plan,'free') when 'team' then 10 else 1 end;
  select count(*)::integer into v_used from public.workspace_members
    where workspace_id=new.workspace_id and role in ('owner','admin','teacher');
  if v_used>v_limit then
    raise exception '已達老師名額上限（% / %），請調整方案',v_used,v_limit
      using errcode='P0001';
  end if;
  return new;
end;$$;
revoke all on function tutor_private.v5_enforce_teacher_quota() from public,anon,authenticated;
create trigger zz_v5_teacher_seat_guard
after insert or update on public.workspace_members for each row
execute function tutor_private.v5_enforce_teacher_quota();

-- Intentionally owner-scoped in V5.1; team member portal will be added in V5.2.
-- Never return student names, emails, payment details or private ledger IDs.
create function public.v5_my_plan()
returns jsonb language plpgsql security definer set search_path='' stable as $$
declare v_uid uuid:=(select auth.uid()); v_workspace uuid;
        v_plan text; v_bonus integer; v_students integer; v_teachers integer;
        v_student_limit integer; v_teacher_limit integer;
begin
  if v_uid is null then raise exception '請先登入'; end if;
  select w.id,e.plan_code,e.extra_student_seats into v_workspace,v_plan,v_bonus
    from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.owner_id=v_uid;
  if not found then return null; end if;
  v_student_limit := (case v_plan when 'free' then 3 when 'pro' then 30
    when 'team' then 100 else 0 end) + v_bonus;
  v_teacher_limit := case v_plan when 'team' then 10 else 1 end;
  select count(*)::integer into v_students from tutor_private.v5_student_seat_ledger
    where workspace_id=v_workspace;
  select count(*)::integer into v_teachers from public.workspace_members
    where workspace_id=v_workspace and role in ('owner','admin','teacher');
  return jsonb_build_object(
    'plan',v_plan,'student_used',v_students,'student_limit',v_student_limit,
    'teacher_used',v_teachers,'teacher_limit',v_teacher_limit,
    'student_can_add',v_students<v_student_limit,
    'teacher_can_add',v_teachers<v_teacher_limit,
    'monthly_price_twd',case v_plan when 'pro' then 99 when 'team' then 399 else 0 end,
    'billing_enabled',false
  );
end;$$;
revoke all on function public.v5_my_plan() from public,anon,authenticated;
grant execute on function public.v5_my_plan() to authenticated;

-- Privileged, auditable manual entitlement API. No browser-facing grant or
-- undocumented backdoor. Intended for service-role administration ONLY.
create function tutor_private.v5_admin_grant_entitlement(
  p_workspace_id uuid, p_plan text, p_extra_students integer,
  p_operator_label text, p_reason text
) returns void language plpgsql security definer set search_path='' as $$
declare v_prior public.v5_workspace_entitlements%rowtype;
begin
  if p_plan not in ('free','pro','team') or p_plan is null
    then raise exception 'Invalid plan'; end if;
  if p_extra_students is null or p_extra_students not between 0 and 100000
    then raise exception 'Invalid extra student seats'; end if;
  if char_length(trim(coalesce(p_operator_label,''))) not between 2 and 120
     or char_length(trim(coalesce(p_reason,''))) not between 5 and 500
    then raise exception 'Operator and reason required'; end if;
  select * into v_prior from public.v5_workspace_entitlements
    where workspace_id=p_workspace_id for update;
  if not found then raise exception 'Workspace entitlement not found'; end if;
  update public.v5_workspace_entitlements
    set plan_code=p_plan,extra_student_seats=p_extra_students,
        granted_at=now(),updated_at=now()
    where workspace_id=p_workspace_id;
  insert into tutor_private.v5_entitlement_grant_audit(
    workspace_id,before_plan,after_plan,before_extra_students,after_extra_students,
    operator_label,reason
  ) values(p_workspace_id,v_prior.plan_code,p_plan,
    v_prior.extra_student_seats,p_extra_students,trim(p_operator_label),trim(p_reason));
end;$$;
revoke all on function tutor_private.v5_admin_grant_entitlement(uuid,text,integer,text,text)
  from public,anon,authenticated;
grant usage on schema tutor_private to service_role;
grant execute on function tutor_private.v5_admin_grant_entitlement(uuid,text,integer,text,text)
  to service_role;
