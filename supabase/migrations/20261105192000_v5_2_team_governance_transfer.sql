-- V5.2 governance transfer: Team authority is NOT V4 personal ownership.
-- Isolated migration. Do not run on hosted Production without release gate.
create table public.v5_team_governance(
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 manager_user_id uuid not null references auth.users(id),
 generation bigint not null default 1 check(generation>0),
 updated_at timestamptz not null default now()
);
alter table public.v5_team_governance enable row level security;
revoke all on public.v5_team_governance from public,anon,authenticated;
grant select on public.v5_team_governance to authenticated;
create policy v5_governance_manager_read on public.v5_team_governance
 for select to authenticated using(manager_user_id=(select auth.uid()));

-- Team roster is independent of V4 personal workspace_members. Deleting an
-- original V4 owner membership would break personal ownership and V4 data.
create table public.v5_team_roster(
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 joined_at timestamptz not null default now(),
 primary key(workspace_id,user_id)
);
create index v5_roster_user_idx on public.v5_team_roster(user_id);
alter table public.v5_team_roster enable row level security;
revoke all on public.v5_team_roster from public,anon,authenticated;
grant select on public.v5_team_roster to authenticated;
create policy v5_roster_member_or_manager_read on public.v5_team_roster
 for select to authenticated using(
  user_id=(select auth.uid()) or
  exists(select 1 from public.v5_team_governance g
    where g.workspace_id=public.v5_team_roster.workspace_id
      and g.manager_user_id=(select auth.uid()))
 );

insert into public.v5_team_governance(workspace_id,manager_user_id)
select w.id,w.owner_id from public.workspaces w
join public.v5_workspace_entitlements e on e.workspace_id=w.id
where e.plan_code='team'
on conflict(workspace_id) do nothing;
insert into public.v5_team_roster(workspace_id,user_id)
select m.workspace_id,m.user_id from public.workspace_members m
join public.v5_team_governance g on g.workspace_id=m.workspace_id
where m.role in('owner','admin','teacher')
on conflict(workspace_id,user_id) do nothing;
insert into public.v5_team_roster(workspace_id,user_id)
select g.workspace_id,g.manager_user_id from public.v5_team_governance g
on conflict(workspace_id,user_id) do nothing;

-- A fresh Team entitlement starts governance exactly once. Re-upgrading
-- after a transfer never silently re-adds the original personal owner.
create function tutor_private.v5_seed_team_governance()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_added uuid;
begin
 if new.plan_code<>'team' then return new; end if;
 select w.owner_id into v_owner from public.workspaces w
  where w.id=new.workspace_id;
 insert into public.v5_team_governance(workspace_id,manager_user_id)
 values(new.workspace_id,v_owner)
 on conflict(workspace_id) do nothing
 returning workspace_id into v_added;
 if v_added is not null then
   insert into public.v5_team_roster(workspace_id,user_id)
   values(new.workspace_id,v_owner)
   on conflict(workspace_id,user_id) do nothing;
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_seed_team_governance()
 from public,anon,authenticated;
create trigger v5_seed_team_governance
after insert or update of plan_code on public.v5_workspace_entitlements
for each row execute function tutor_private.v5_seed_team_governance();

-- Serialize roster seat checks against all concurrent joins and exits.
create function tutor_private.v5_roster_quota_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_used integer;
begin
 perform 1 from public.workspaces w
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=new.workspace_id and e.plan_code='team'
  for update of w;
 if not found then raise exception 'Team 方案未啟用' using errcode='42501'; end if;
 select count(*)::int into v_used from public.v5_team_roster r
  where r.workspace_id=new.workspace_id;
 if v_used>=10 then
   raise exception 'Team 老師名額已滿（10/10）' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_roster_quota_guard()
 from public,anon,authenticated;
create trigger v5_roster_quota_guard before insert on public.v5_team_roster
for each row execute function tutor_private.v5_roster_quota_guard();

-- V5.1 quota previously counted the legacy V4 membership rows; for Team the
-- roster is now authoritative. Keep Free/Pro V4 member quota unchanged.
create or replace function tutor_private.v5_enforce_teacher_quota()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_plan text; v_used integer;
begin
 if tg_op='UPDATE' and new.workspace_id=old.workspace_id
   and old.role in('owner','admin','teacher') then return new; end if;
 perform 1 from public.workspaces w where w.id=new.workspace_id for update;
 if not found then raise exception 'Workspace missing' using errcode='23503'; end if;
 select plan_code into v_plan from public.v5_workspace_entitlements
  where workspace_id=new.workspace_id;
 if v_plan='team' then return new; end if;
 select count(*)::int into v_used from public.workspace_members
  where workspace_id=new.workspace_id and role in('owner','admin','teacher');
 if v_used>1 then
  raise exception '非 Team 方案僅能有一位老師' using errcode='23514';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_enforce_teacher_quota()
 from public,anon,authenticated;

-- The existing read policy now lets the current Team manager see plan status,
-- without giving the manager any V4 personal ownership or billing permissions.
drop policy v5_entitlement_owner_or_admin_read on public.v5_workspace_entitlements;
create policy v5_entitlement_owner_or_admin_read
 on public.v5_workspace_entitlements for select to authenticated using(
 exists(select 1 from public.workspaces w
   where w.id=public.v5_workspace_entitlements.workspace_id
     and(w.owner_id=(select auth.uid()) or
       exists(select 1 from public.workspace_members m
          where m.workspace_id=w.id and m.user_id=(select auth.uid())
             and m.role in('owner','admin'))))
 or exists(select 1 from public.v5_team_governance g
   where g.workspace_id=public.v5_workspace_entitlements.workspace_id
     and g.manager_user_id=(select auth.uid()))
);

drop policy v5_project_owner_or_assigned_read on public.v5_team_projects;
create policy v5_project_owner_or_assigned_read on public.v5_team_projects
 for select to authenticated using(
 exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=public.v5_team_projects.workspace_id
    and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
 or exists(select 1 from public.v5_team_project_members pm
   join public.v5_team_roster r on r.workspace_id=pm.workspace_id
     and r.user_id=pm.user_id
   where pm.project_id=public.v5_team_projects.id
     and pm.user_id=(select auth.uid()))
);
drop policy v5_project_owner_create on public.v5_team_projects;
create policy v5_project_owner_create on public.v5_team_projects
 for insert to authenticated with check(
 created_by=(select auth.uid()) and
 exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=public.v5_team_projects.workspace_id
   and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
);
drop policy v5_project_owner_update on public.v5_team_projects;
create policy v5_project_owner_update on public.v5_team_projects
 for update to authenticated using(
 exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=public.v5_team_projects.workspace_id
   and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
) with check(
 exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=public.v5_team_projects.workspace_id
   and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
);

drop policy v5_project_member_self_or_owner_read on public.v5_team_project_members;
create policy v5_project_member_self_or_owner_read
 on public.v5_team_project_members for select to authenticated using(
 (user_id=(select auth.uid()) and exists(
    select 1 from public.v5_team_roster r
    where r.workspace_id=public.v5_team_project_members.workspace_id
      and r.user_id=(select auth.uid())))
 or exists(select 1 from public.v5_team_governance g
   where g.workspace_id=public.v5_team_project_members.workspace_id
     and g.manager_user_id=(select auth.uid()))
);
drop policy v5_project_member_owner_assign on public.v5_team_project_members;
create policy v5_project_member_owner_assign
 on public.v5_team_project_members for insert to authenticated with check(
 exists(select 1 from public.v5_team_governance g
   join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
   where g.workspace_id=public.v5_team_project_members.workspace_id
    and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
);
drop policy v5_project_member_owner_unassign on public.v5_team_project_members;
create policy v5_project_member_owner_unassign
 on public.v5_team_project_members for delete to authenticated using(
 exists(select 1 from public.v5_team_governance g
   where g.workspace_id=public.v5_team_project_members.workspace_id
     and g.manager_user_id=(select auth.uid()))
);

-- Guard can bypass RLS, but independently checks the roster + project state.
create or replace function tutor_private.v5_project_assignment_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
 select p.status into v_status from public.v5_team_projects p
  where p.id=new.project_id and p.workspace_id=new.workspace_id;
 if v_status is distinct from 'active' then
  raise exception '無法指派不存在或已封存專案' using errcode='23514'; end if;
 if not exists(select 1 from public.v5_team_roster r
   where r.workspace_id=new.workspace_id and r.user_id=new.user_id) then
  raise exception '必須先加入 Team 才能指派專案' using errcode='42501'; end if;
 return new;
end;$$;
revoke all on function tutor_private.v5_project_assignment_guard()
 from public,anon,authenticated;

drop policy v5_team_invite_owner_or_recipient_read on public.v5_team_invitations;
create policy v5_team_invite_owner_or_recipient_read
 on public.v5_team_invitations for select to authenticated using(
 exists(select 1 from public.v5_team_governance g
  where g.workspace_id=public.v5_team_invitations.workspace_id
   and g.manager_user_id=(select auth.uid()))
 or recipient_email=lower(coalesce((select auth.jwt())->>'email',''))
);
drop policy v5_team_invite_owner_create on public.v5_team_invitations;
create policy v5_team_invite_owner_create
 on public.v5_team_invitations for insert to authenticated with check(
 invited_by=(select auth.uid()) and status='pending'
 and accepted_by is null and acted_at is null
 and expires_at>now() and expires_at<=now()+interval '8 days'
 and exists(select 1 from public.v5_team_governance g
  join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
  where g.workspace_id=public.v5_team_invitations.workspace_id
   and g.manager_user_id=(select auth.uid()) and e.plan_code='team')
);

create or replace function public.v5_accept_team_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
  v_mail text; v_target public.v5_team_invitations%rowtype; v_owner uuid;
begin
 if v_user is null then raise exception '請先登入' using errcode='42501'; end if;
 select lower(email) into v_mail from auth.users
  where id=v_user and email_confirmed_at is not null;
 if v_mail is null then raise exception '電子郵件尚未驗證' using errcode='42501'; end if;
 select * into v_target from public.v5_team_invitations
  where id=p_invitation_id and status='pending' for update;
 if not found or v_target.recipient_email<>v_mail or v_target.expires_at<=now()
 then raise exception '邀請不存在或已失效' using errcode='42501'; end if;
 select w.owner_id into v_owner from public.workspaces w
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=v_target.workspace_id and e.plan_code='team'
  for update of w;
 if not found then raise exception 'Team 方案尚未啟用' using errcode='42501'; end if;
 -- Keep legacy V4 membership for accepted non-owner teacher, without
 -- making it the source of Team authorization or teacher-seat counting.
 if v_owner<>v_user then
  insert into public.workspace_members(workspace_id,user_id,role)
  values(v_target.workspace_id,v_user,'teacher')
  on conflict(workspace_id,user_id) do nothing;
 end if;
 insert into public.v5_team_roster(workspace_id,user_id)
 values(v_target.workspace_id,v_user)
 on conflict(workspace_id,user_id) do nothing;
 update public.v5_team_invitations
  set status='accepted',acted_at=now(),accepted_by=v_user
  where id=v_target.id;
 return jsonb_build_object('status','accepted','workspace_id',v_target.workspace_id);
end;$$;
revoke all on function public.v5_accept_team_invitation(uuid)
 from public,anon,authenticated;
grant execute on function public.v5_accept_team_invitation(uuid) to authenticated;

create or replace function public.v5_cancel_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception '未登入' using errcode='42501'; end if;
 update public.v5_team_invitations i
 set status='cancelled',acted_at=now()
 from public.v5_team_governance g
 where i.id=p_invitation_id and i.status='pending'
  and g.workspace_id=i.workspace_id
  and g.manager_user_id=(select auth.uid());
 if not found then raise exception '無權取消邀請' using errcode='42501'; end if;
end;$$;
revoke all on function public.v5_cancel_team_invitation(uuid)
 from public,anon,authenticated;
grant execute on function public.v5_cancel_team_invitation(uuid) to authenticated;

create or replace function public.v5_leave_team(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_owner uuid;
begin
 if v_actor is null then raise exception '未登入' using errcode='42501'; end if;
 select w.owner_id into v_owner from public.workspaces w
  join public.v5_team_governance g on g.workspace_id=w.id
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=p_workspace_id and e.plan_code='team'
    and g.manager_user_id<>v_actor for update of w;
 if not found then raise exception '管理者須先轉讓，非成員不能退出'
  using errcode='42501'; end if;
 delete from public.v5_team_roster r
  where r.workspace_id=p_workspace_id and r.user_id=v_actor;
 if not found then raise exception '目前不是 Team 成員'
  using errcode='42501'; end if;
 delete from public.v5_team_project_members pm
  where pm.workspace_id=p_workspace_id and pm.user_id=v_actor;
 if v_actor<>v_owner then
  delete from public.workspace_members m
   where m.workspace_id=p_workspace_id and m.user_id=v_actor and m.role='teacher';
 end if;
 insert into tutor_private.v5_team_membership_audit(
  workspace_id,actor_id,subject_user_id,event)
 values(p_workspace_id,v_actor,v_actor,'teacher_left');
 return jsonb_build_object('left',true,'workspace_id',p_workspace_id);
end;$$;
revoke all on function public.v5_leave_team(uuid) from public,anon,authenticated;
grant execute on function public.v5_leave_team(uuid) to authenticated;

create or replace function public.v5_remove_team_teacher(
 p_workspace_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_owner uuid;
begin
 if v_actor is null or p_user_id is null or v_actor=p_user_id
 then raise exception '不能移除本人或未知老師' using errcode='42501'; end if;
 select w.owner_id into v_owner from public.workspaces w
  join public.v5_team_governance g on g.workspace_id=w.id
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=p_workspace_id and e.plan_code='team'
    and g.manager_user_id=v_actor for update of w;
 if not found then raise exception '僅現任 Team 管理者可移除老師'
  using errcode='42501'; end if;
 delete from public.v5_team_roster r
  where r.workspace_id=p_workspace_id and r.user_id=p_user_id;
 if not found then raise exception '目標不是 Team 老師' using errcode='42501'; end if;
 delete from public.v5_team_project_members pm
  where pm.workspace_id=p_workspace_id and pm.user_id=p_user_id;
 if p_user_id<>v_owner then
   delete from public.workspace_members m
   where m.workspace_id=p_workspace_id and m.user_id=p_user_id and m.role='teacher';
 end if;
 insert into tutor_private.v5_team_membership_audit(
  workspace_id,actor_id,subject_user_id,event)
 values(p_workspace_id,v_actor,p_user_id,'teacher_removed');
end;$$;
revoke all on function public.v5_remove_team_teacher(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.v5_remove_team_teacher(uuid,uuid)
 to authenticated;

create table public.v5_team_manager_transfers(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 from_user_id uuid not null references auth.users(id),
 to_user_id uuid not null references auth.users(id),
 status text not null default 'pending'
  check(status in('pending','accepted','declined','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '7 days'),
 decided_at timestamptz,
 constraint v5_manager_cannot_transfer_to_self check(from_user_id<>to_user_id)
);
create unique index v5_one_pending_manager_transfer
 on public.v5_team_manager_transfers(workspace_id) where status='pending';
create index v5_transfer_recipient_idx on public.v5_team_manager_transfers(to_user_id);
alter table public.v5_team_manager_transfers enable row level security;
revoke all on public.v5_team_manager_transfers from public,anon,authenticated;
grant select on public.v5_team_manager_transfers to authenticated;
create policy v5_transfer_participants_read
 on public.v5_team_manager_transfers for select to authenticated using(
  from_user_id=(select auth.uid()) or to_user_id=(select auth.uid())
 );

create table tutor_private.v5_team_governance_audit(
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id),
 transfer_id uuid not null references public.v5_team_manager_transfers(id),
 actor_id uuid not null,
 before_manager_id uuid not null,
 proposed_manager_id uuid not null,
 event text not null check(event in('proposed','accepted','declined','cancelled')),
 occurred_at timestamptz not null default now()
);
alter table tutor_private.v5_team_governance_audit enable row level security;
revoke all on tutor_private.v5_team_governance_audit from public,anon,authenticated;

create function public.v5_propose_team_manager(
 p_workspace_id uuid,p_target_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_id uuid;
begin
 if v_actor is null or p_target_user_id is null or v_actor=p_target_user_id
 then raise exception '不可轉讓給自己或未知老師' using errcode='42501'; end if;
 perform 1 from public.workspaces w
  join public.v5_team_governance g on g.workspace_id=w.id
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=p_workspace_id and e.plan_code='team'
   and g.manager_user_id=v_actor for update of w;
 if not found then raise exception '只有現任管理者可提出轉讓'
   using errcode='42501'; end if;
 if not exists(select 1 from public.v5_team_roster r
   join auth.users u on u.id=r.user_id
   where r.workspace_id=p_workspace_id and r.user_id=p_target_user_id
    and u.email_confirmed_at is not null) then
  raise exception '接任者必須是已加入 Team 的已驗證老師'
   using errcode='42501';
 end if;
 if exists(select 1 from public.v5_team_manager_transfers t
    where t.workspace_id=p_workspace_id and t.status='pending') then
  raise exception '已有待處理管理權轉讓' using errcode='23505'; end if;
 insert into public.v5_team_manager_transfers(
  workspace_id,from_user_id,to_user_id)
 values(p_workspace_id,v_actor,p_target_user_id) returning id into v_id;
 insert into tutor_private.v5_team_governance_audit(
  workspace_id,transfer_id,actor_id,before_manager_id,proposed_manager_id,event)
 values(p_workspace_id,v_id,v_actor,v_actor,p_target_user_id,'proposed');
 return v_id;
end;$$;
revoke all on function public.v5_propose_team_manager(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.v5_propose_team_manager(uuid,uuid)
 to authenticated;

create function public.v5_respond_team_manager(
 p_transfer_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_ws uuid;
 v_transfer public.v5_team_manager_transfers%rowtype;
begin
 if v_actor is null or p_accept is null then
  raise exception '無效管理權確認' using errcode='42501'; end if;
 select t.workspace_id into v_ws from public.v5_team_manager_transfers t
  where t.id=p_transfer_id;
 if v_ws is null then raise exception '找不到轉讓' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_ws for update;
 select * into v_transfer from public.v5_team_manager_transfers
  where id=p_transfer_id and status='pending' for update;
 if not found or v_transfer.to_user_id<>v_actor
   or v_transfer.expires_at<=now() then
  raise exception '目前帳號無法接受這筆轉讓' using errcode='42501'; end if;
 if not exists(select 1 from public.v5_team_governance g
   join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
   where g.workspace_id=v_ws and g.manager_user_id=v_transfer.from_user_id
     and e.plan_code='team') then
  raise exception '原管理者或方案已改變' using errcode='42501'; end if;
 if not exists(select 1 from public.v5_team_roster r
  where r.workspace_id=v_ws and r.user_id=v_actor) then
  raise exception '接任者已離開 Team' using errcode='42501'; end if;
 if p_accept then
  update public.v5_team_governance
  set manager_user_id=v_actor,generation=generation+1,updated_at=now()
  where workspace_id=v_ws and manager_user_id=v_transfer.from_user_id;
  if not found then raise exception '管理權已改變' using errcode='42501'; end if;
 end if;
 update public.v5_team_manager_transfers
  set status=case when p_accept then 'accepted' else 'declined' end,
   decided_at=now()
  where id=p_transfer_id;
 insert into tutor_private.v5_team_governance_audit(
  workspace_id,transfer_id,actor_id,before_manager_id,proposed_manager_id,event)
 values(v_ws,p_transfer_id,v_actor,v_transfer.from_user_id,v_actor,
  case when p_accept then 'accepted' else 'declined' end);
 return jsonb_build_object('status',
  case when p_accept then 'accepted' else 'declined' end,
  'workspace_id',v_ws);
end;$$;
revoke all on function public.v5_respond_team_manager(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.v5_respond_team_manager(uuid,boolean)
 to authenticated;

create function public.v5_cancel_team_manager(p_transfer_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_ws uuid;
 v_transfer public.v5_team_manager_transfers%rowtype;
begin
 if v_actor is null then raise exception '未登入' using errcode='42501'; end if;
 select t.workspace_id into v_ws from public.v5_team_manager_transfers t
  where t.id=p_transfer_id;
 if v_ws is null then raise exception '找不到轉讓' using errcode='42501'; end if;
 perform 1 from public.workspaces w where w.id=v_ws for update;
 select * into v_transfer from public.v5_team_manager_transfers
  where id=p_transfer_id and status='pending' for update;
 if not found or v_transfer.from_user_id<>v_actor then
  raise exception '只有原管理者可取消待處理轉讓' using errcode='42501'; end if;
 if not exists(select 1 from public.v5_team_governance g
   where g.workspace_id=v_ws and g.manager_user_id=v_actor) then
  raise exception '管理權已改變' using errcode='42501'; end if;
 update public.v5_team_manager_transfers
 set status='cancelled',decided_at=now() where id=p_transfer_id;
 insert into tutor_private.v5_team_governance_audit(
   workspace_id,transfer_id,actor_id,before_manager_id,proposed_manager_id,event)
 values(v_ws,p_transfer_id,v_actor,v_actor,v_transfer.to_user_id,'cancelled');
end;$$;
revoke all on function public.v5_cancel_team_manager(uuid)
 from public,anon,authenticated;
grant execute on function public.v5_cancel_team_manager(uuid) to authenticated;

-- Safe manager-only discovery. Never include student names, payments or tokens.
create function public.v5_my_managed_teams()
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'workspace_id',g.workspace_id,'manager_user_id',g.manager_user_id,
   'teacher_used',(select count(*)::int from public.v5_team_roster r
      where r.workspace_id=g.workspace_id),
   'teacher_limit',10,
   'plan',e.plan_code
  )),'[]'::jsonb)
 from public.v5_team_governance g
 join public.v5_workspace_entitlements e on e.workspace_id=g.workspace_id
 where g.manager_user_id=(select auth.uid()) and e.plan_code='team';
$$;
revoke all on function public.v5_my_managed_teams() from public,anon,authenticated;
grant execute on function public.v5_my_managed_teams() to authenticated;
