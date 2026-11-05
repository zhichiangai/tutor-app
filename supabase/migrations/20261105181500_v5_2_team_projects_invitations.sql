-- V5.2: Team member invitations + per-project access metadata.
-- Stacked on PR #51; run only on disposable local Supabase.
-- V4 lessons, payments and students remain teacher-owned. V5.3 will handle
-- authorized cross-teacher financial/schedule access with separate policies.
-- A Team is the owner's existing workspace with plan_code='team'; DO NOT
-- create a second owner workspace (V4 enforces one workspace per owner).

create table public.v5_team_projects (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 80),
 status text not null default 'active' check(status in ('active','archived')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,workspace_id)
);
create unique index v5_project_name_unique_per_workspace
 on public.v5_team_projects(workspace_id,lower(btrim(name)));
alter table public.v5_team_projects enable row level security;
revoke all on public.v5_team_projects from public,anon,authenticated;
grant select,insert,update on public.v5_team_projects to authenticated;

create table public.v5_team_project_members (
 project_id uuid not null,
 workspace_id uuid not null,
 user_id uuid not null,
 assigned_at timestamptz not null default now(),
 primary key(project_id,user_id),
 foreign key(project_id,workspace_id) references public.v5_team_projects(id,workspace_id)
   on delete cascade,
 foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id)
   on delete cascade
);
alter table public.v5_team_project_members enable row level security;
revoke all on public.v5_team_project_members from public,anon,authenticated;
grant select,insert,delete on public.v5_team_project_members to authenticated;

-- Existing V4 membership table remains the source of truth for teacher seats.
-- Team owners can see/revoke their invited teachers. No role editing is allowed.
grant delete on public.workspace_members to authenticated;
create policy v5_owner_read_team_members on public.workspace_members
 for select to authenticated
 using (exists (
   select 1 from public.workspaces w
   join public.v5_workspace_entitlements e on e.workspace_id=w.id
   where w.id=public.workspace_members.workspace_id and w.owner_id=(select auth.uid())
     and e.plan_code='team'
 ));
create policy v5_owner_remove_team_teacher on public.workspace_members
 for delete to authenticated
 using(role='teacher' and user_id<>(select auth.uid())
  and exists (
   select 1 from public.workspaces w
   join public.v5_workspace_entitlements e on e.workspace_id=w.id
   where w.id=public.workspace_members.workspace_id and w.owner_id=(select auth.uid())
     and e.plan_code='team'
 ));

-- Project RLS deliberately does not broaden legacy V4 students/lessons/payments.
create policy v5_project_owner_or_assigned_read on public.v5_team_projects
 for select to authenticated using (
   exists(select 1 from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.id=public.v5_team_projects.workspace_id and e.plan_code='team'
      and w.owner_id=(select auth.uid()))
   or exists(select 1 from public.v5_team_project_members pm
     where pm.project_id=public.v5_team_projects.id and pm.user_id=(select auth.uid()))
 );
create policy v5_project_owner_create on public.v5_team_projects
 for insert to authenticated with check (
   created_by=(select auth.uid()) and
   exists(select 1 from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.id=public.v5_team_projects.workspace_id and w.owner_id=(select auth.uid())
      and e.plan_code='team')
 );
create policy v5_project_owner_update on public.v5_team_projects
 for update to authenticated using (
   exists(select 1 from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.id=public.v5_team_projects.workspace_id and w.owner_id=(select auth.uid())
      and e.plan_code='team')
 ) with check (
   created_by=(select auth.uid()) and
   exists(select 1 from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.id=public.v5_team_projects.workspace_id and w.owner_id=(select auth.uid())
      and e.plan_code='team')
 );

create policy v5_project_member_self_or_owner_read on public.v5_team_project_members
 for select to authenticated using (
   user_id=(select auth.uid())
   or exists(select 1 from public.workspaces w
     where w.id=public.v5_team_project_members.workspace_id and w.owner_id=(select auth.uid()))
 );
create policy v5_project_member_owner_assign on public.v5_team_project_members
 for insert to authenticated with check (
   exists(select 1 from public.workspaces w
    join public.v5_workspace_entitlements e on e.workspace_id=w.id
    where w.id=public.v5_team_project_members.workspace_id and w.owner_id=(select auth.uid())
      and e.plan_code='team')
   and exists(select 1 from public.v5_team_projects p
    where p.id=public.v5_team_project_members.project_id and p.workspace_id=public.v5_team_project_members.workspace_id and p.status='active')
 );
create policy v5_project_member_owner_unassign on public.v5_team_project_members
 for delete to authenticated using (
   exists(select 1 from public.workspaces w
    where w.id=public.v5_team_project_members.workspace_id and w.owner_id=(select auth.uid()))
 );

-- Teacher invitation is email-addressed; simply knowing a UUID does not
-- join a stranger to a Team. Only a verified recipient may accept.
create table public.v5_team_invitations (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 recipient_email text not null
   check(length(recipient_email) between 5 and 254
     and recipient_email=lower(btrim(recipient_email))
     and recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
 invited_by uuid not null references auth.users(id),
 status text not null default 'pending'
   check(status in ('pending','accepted','cancelled','declined')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '7 days'),
 acted_at timestamptz,
 accepted_by uuid references auth.users(id)
);
create unique index v5_only_one_pending_team_invite
 on public.v5_team_invitations(workspace_id,recipient_email)
 where status='pending';
alter table public.v5_team_invitations enable row level security;
revoke all on public.v5_team_invitations from public,anon,authenticated;
grant select,insert on public.v5_team_invitations to authenticated;
create policy v5_team_invite_owner_or_recipient_read on public.v5_team_invitations
 for select to authenticated using (
   exists(select 1 from public.workspaces w
    where w.id=public.v5_team_invitations.workspace_id and w.owner_id=(select auth.uid()))
   or recipient_email=lower(coalesce((select auth.jwt())->>'email',''))
 );
create policy v5_team_invite_owner_create on public.v5_team_invitations
 for insert to authenticated with check (
   invited_by=(select auth.uid()) and status='pending'
   and accepted_by is null and acted_at is null
   and expires_at>now() and expires_at<=now()+interval '8 days'
   and exists(select 1 from public.workspaces w
     join public.v5_workspace_entitlements e on e.workspace_id=w.id
     where w.id=public.v5_team_invitations.workspace_id and w.owner_id=(select auth.uid())
       and e.plan_code='team')
 );

-- RPC checks the current Auth users table rather than trusting client input or
-- stale user_metadata. An accepted invitation creates the V4 membership row,
-- so the V5.1 10-teacher quota trigger still enforces all concurrency.
create function public.v5_accept_team_invitation(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());
        v_mail text; v_target public.v5_team_invitations%rowtype;
begin
 if v_user is null then raise exception '請先登入' using errcode='42501'; end if;
 select lower(email) into v_mail from auth.users
  where id=v_user and email_confirmed_at is not null;
 if v_mail is null then
  raise exception '需要已驗證電子郵件帳號' using errcode='42501';
 end if;
 select * into v_target from public.v5_team_invitations
  where id=p_invitation_id and status='pending' for update;
 if not found then raise exception '邀請不存在或已處理' using errcode='42501'; end if;
 if v_target.recipient_email<>v_mail or v_target.expires_at<=now() then
  raise exception '邀請不適用於目前帳號' using errcode='42501';
 end if;
 perform 1 from public.workspaces w
  join public.v5_workspace_entitlements e on e.workspace_id=w.id
  where w.id=v_target.workspace_id and e.plan_code='team' for update of w;
 if not found then raise exception 'Team 方案尚未啟用' using errcode='42501'; end if;
 -- Block identity reassignment. Existing membership is a no-op.
 insert into public.workspace_members(workspace_id,user_id,role)
  values(v_target.workspace_id,v_user,'teacher')
  on conflict(workspace_id,user_id) do nothing;
 update public.v5_team_invitations
  set status='accepted',acted_at=now(),accepted_by=v_user
  where id=v_target.id;
 return jsonb_build_object('status','accepted','workspace_id',v_target.workspace_id);
end;$$;
revoke all on function public.v5_accept_team_invitation(uuid) from public,anon,authenticated;
grant execute on function public.v5_accept_team_invitation(uuid) to authenticated;

create function public.v5_decline_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_mail text;
begin
 if v_user is null then raise exception '請先登入' using errcode='42501'; end if;
 select lower(email) into v_mail from auth.users
  where id=v_user and email_confirmed_at is not null;
 if v_mail is null then raise exception '未驗證電子郵件' using errcode='42501'; end if;
 update public.v5_team_invitations
  set status='declined',acted_at=now()
  where id=p_invitation_id and status='pending'
    and recipient_email=v_mail and expires_at>now();
 if not found then raise exception '邀請不適用於目前帳號' using errcode='42501'; end if;
end;$$;
revoke all on function public.v5_decline_team_invitation(uuid) from public,anon,authenticated;
grant execute on function public.v5_decline_team_invitation(uuid) to authenticated;

create function public.v5_cancel_team_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then
  raise exception '請先登入' using errcode='42501';
 end if;
 update public.v5_team_invitations i
  set status='cancelled',acted_at=now()
  from public.workspaces w
  where i.id=p_invitation_id and i.status='pending'
    and w.id=i.workspace_id and w.owner_id=(select auth.uid());
 if not found then raise exception '無權取消這筆邀請' using errcode='42501'; end if;
end;$$;
revoke all on function public.v5_cancel_team_invitation(uuid) from public,anon,authenticated;
grant execute on function public.v5_cancel_team_invitation(uuid) to authenticated;
