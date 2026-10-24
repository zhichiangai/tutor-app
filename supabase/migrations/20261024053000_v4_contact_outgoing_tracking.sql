-- Outgoing tracking is opaque: a submitted address always receives the same
-- pending receipt, whether or not the recipient has signed up.
alter table public.v4_account_contacts add column expires_at timestamptz not null default (now()+interval '14 days');
-- Preserve original creation time when assigning the first expiry to legacy invitations.
update public.v4_account_contacts set expires_at=created_at+interval '14 days';
create table public.v4_contact_outgoing_invites (
 id uuid primary key default gen_random_uuid(),
 requested_by uuid not null references auth.users(id),
 target_email text not null,
 my_role text not null check(my_role in ('teacher','parent')),
 contact_id uuid references public.v4_account_contacts(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','cancelled','connected','declined','disconnected')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '14 days'),
 updated_at timestamptz not null default now()
);
create unique index v4_outgoing_pending_unique on public.v4_contact_outgoing_invites(requested_by,target_email,my_role) where status='pending';
create index v4_outgoing_actor_idx on public.v4_contact_outgoing_invites(requested_by,created_at desc);
alter table public.v4_contact_outgoing_invites enable row level security;
revoke all on public.v4_contact_outgoing_invites from public,anon,authenticated;
insert into public.v4_contact_outgoing_invites
 (requested_by,target_email,my_role,contact_id,created_at,expires_at)
select c.requested_by,pg_catalog.lower(u.email),
 case when c.requested_by=c.teacher_id then 'teacher' else 'parent' end,
 c.id,c.created_at,c.expires_at
from public.v4_account_contacts c join auth.users u
 on u.id=case when c.requested_by=c.teacher_id then c.parent_id else c.teacher_id end
where c.status='pending';

create or replace function public.v4_contact_request(p_email text,p_my_role text)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=(select auth.uid()); v_target uuid; v_teacher uuid; v_parent uuid;
 v_email text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
 v_contact uuid;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 if p_my_role not in ('teacher','parent') or p_my_role is null then raise exception '請選擇老師或家長身分'; end if;
 if pg_catalog.length(v_email)<5 or pg_catalog.length(v_email)>254 or v_email not like '%@%.%'
 then raise exception '請輸入有效的 Email'; end if;
 perform tutor_private.v4_limit('v4_contact_request',10);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_actor::text||':'||v_email||':'||p_my_role));
 -- Reinvite after expiry. A cancelled contact retains its historical record.
 update public.v4_contact_outgoing_invites set status='cancelled',updated_at=now()
 where requested_by=v_actor and target_email=v_email and my_role=p_my_role
  and status='pending' and expires_at<=now();
 select u.id into v_target from auth.users u where pg_catalog.lower(u.email)=v_email limit 1;
 if v_target is not null and v_target<>v_actor then
  v_teacher:=case when p_my_role='teacher' then v_actor else v_target end;
  v_parent:=case when p_my_role='parent' then v_actor else v_target end;
  if exists(select 1 from public.v4_account_contacts
    where teacher_id=v_teacher and parent_id=v_parent and status='connected')
  then return pg_catalog.jsonb_build_object('submitted',true); end if;
  update public.v4_account_contacts set status='cancelled',updated_at=now()
   where teacher_id=v_teacher and parent_id=v_parent and status='pending' and expires_at<=now();
  insert into public.v4_account_contacts(teacher_id,parent_id,requested_by)
   values(v_teacher,v_parent,v_actor) on conflict do nothing returning id into v_contact;
  if v_contact is null then
   select id into v_contact from public.v4_account_contacts
    where teacher_id=v_teacher and parent_id=v_parent and status='pending' and requested_by=v_actor;
  end if;
 end if;
 -- Identical visible pending receipt for registered, unregistered, and self Email.
 insert into public.v4_contact_outgoing_invites(requested_by,target_email,my_role,contact_id)
 values(v_actor,v_email,p_my_role,v_contact) on conflict do nothing;
 return pg_catalog.jsonb_build_object('submitted',true);
end $fn$;

create or replace function public.v4_contact_inbox()
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=(select auth.uid()); v_rows jsonb;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 select coalesce(pg_catalog.jsonb_agg(row order by created_at desc),'[]'::jsonb) into v_rows
 from (
  select c.created_at,pg_catalog.jsonb_build_object('id',c.id,'status',c.status,'my_role',
    case when c.teacher_id=v_actor then 'teacher' else 'parent' end,
    'other_name',coalesce(nullif(p.display_name,''),'另一位使用者'),
    'requested_by_me',c.requested_by=v_actor,'created_at',c.created_at,
    'expires_at',c.expires_at,'kind','contact') row
  from public.v4_account_contacts c left join public.profiles p
    on p.id=(case when c.teacher_id=v_actor then c.parent_id else c.teacher_id end)
  where (c.teacher_id=v_actor or c.parent_id=v_actor)
    and (c.status in ('connected','disconnected') or
      (c.status='pending' and c.requested_by<>v_actor and c.expires_at>now()))
  union all
  select o.created_at,pg_catalog.jsonb_build_object('id',o.id,
    'status',case when o.status='pending' and o.expires_at<=now() then 'expired' else o.status end,
    'my_role',o.my_role,'other_name',o.target_email,'requested_by_me',true,
    'created_at',o.created_at,'expires_at',o.expires_at,'kind','outgoing') row
  from public.v4_contact_outgoing_invites o
  where o.requested_by=v_actor and o.status in ('pending','cancelled','declined')
 ) x;
 return v_rows;
end $fn$;

create or replace function public.v4_contact_action(p_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=(select auth.uid()); v_link public.v4_account_contacts%rowtype;
 v_invite public.v4_contact_outgoing_invites%rowtype; v_next text;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 if p_action not in ('approve','decline','cancel','disconnect') or p_action is null
 then raise exception '不支援的操作'; end if;
 if p_action='cancel' then
  select * into v_invite from public.v4_contact_outgoing_invites where id=p_id for update;
  if found then
   if v_invite.requested_by<>v_actor or v_invite.status<>'pending' or v_invite.expires_at<=now()
   then raise exception '只能撤回自己尚未處理的邀請'; end if;
   update public.v4_contact_outgoing_invites set status='cancelled',updated_at=now() where id=p_id;
   if v_invite.contact_id is not null then
    update public.v4_account_contacts set status='cancelled',updated_at=now()
     where id=v_invite.contact_id and requested_by=v_actor and status='pending';
   end if;
   return 'cancelled';
  end if;
 end if;
 select * into v_link from public.v4_account_contacts c where c.id=p_id for update;
 if not found or v_actor not in (v_link.teacher_id,v_link.parent_id)
 then raise exception '連結不存在或無權操作'; end if;
 if p_action in ('approve','decline') then
  if v_link.status<>'pending' or v_link.requested_by=v_actor or v_link.expires_at<=now()
  then raise exception '邀請已過期或無權處理'; end if;
  v_next:=case when p_action='approve' then 'connected' else 'declined' end;
 elsif p_action='cancel' then
  if v_link.status<>'pending' or v_link.requested_by<>v_actor then
   raise exception '只能撤回自己尚未處理的邀請'; end if;
  v_next:='cancelled';
 else
  if v_link.status<>'connected' then raise exception '只能解除已連結的聯絡人'; end if;
  v_next:='disconnected';
 end if;
 update public.v4_account_contacts set status=v_next,updated_at=now() where id=p_id;
 update public.v4_contact_outgoing_invites set status=v_next,updated_at=now()
  where contact_id=p_id and status='pending';
 return v_next;
end $fn$;
