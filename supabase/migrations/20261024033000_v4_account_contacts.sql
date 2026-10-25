-- V4 isolated feature: teacher/parent contacts without students.
-- Account-level contacts DO NOT grant access to any student, lesson, or payment.
-- In a Mac development checkout create this migration with "supabase migration new"
-- before production promotion. Never run directly against production without JWT QA.
create table public.v4_account_contacts(
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id),
 parent_id uuid not null references auth.users(id),
 requested_by uuid not null references auth.users(id),
 status text not null default 'pending'
   check(status in ('pending','connected','declined','cancelled','disconnected')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint v4_contact_distinct_people check(teacher_id<>parent_id),
 constraint v4_contact_requested_party check(requested_by in (teacher_id,parent_id))
);
create unique index v4_account_contacts_active_pair
  on public.v4_account_contacts(teacher_id,parent_id)
  where status in ('pending','connected');
create index v4_account_contacts_parent_idx on public.v4_account_contacts(parent_id,status);
create index v4_account_contacts_teacher_idx on public.v4_account_contacts(teacher_id,status);
alter table public.v4_account_contacts enable row level security;
revoke all on table public.v4_account_contacts from public,anon,authenticated;

-- Same neutral result whether the target email is found or not.
-- A contact request cannot promote itself into student_guardians.
create function public.v4_contact_request(p_email text,p_my_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=(select auth.uid());
 v_target uuid;
 v_teacher uuid;
 v_parent uuid;
 v_email text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
begin
 if v_actor is null then raise exception '請先登入'; end if;
 if p_my_role is null or p_my_role not in ('teacher','parent') then raise exception '請選擇老師或家長身分'; end if;
 if pg_catalog.length(v_email)<5 or pg_catalog.length(v_email)>254 or
   v_email not like '%@%.%' then raise exception '請輸入有效的 Email'; end if;
 perform tutor_private.v4_limit('v4_contact_request',10);
 select u.id into v_target from auth.users u where pg_catalog.lower(u.email)=v_email limit 1;
 if v_target is null or v_target=v_actor then
   return pg_catalog.jsonb_build_object('submitted',true);
 end if;
 v_teacher:=case when p_my_role='teacher' then v_actor else v_target end;
 v_parent:=case when p_my_role='parent' then v_actor else v_target end;
 insert into public.v4_account_contacts(teacher_id,parent_id,requested_by)
 values(v_teacher,v_parent,v_actor)
 on conflict do nothing;
 return pg_catalog.jsonb_build_object('submitted',true);
end $$;
revoke all on function public.v4_contact_request(text,text) from public,anon;
grant execute on function public.v4_contact_request(text,text) to authenticated;

create function public.v4_contact_inbox()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_rows jsonb;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'id',c.id,'status',c.status,'my_role',
    case when c.teacher_id=v_actor then 'teacher' else 'parent' end,
  'other_name',coalesce(nullif(p.display_name,''),'另一位使用者'),
  'requested_by_me',c.requested_by=v_actor,
  'created_at',c.created_at
 ) order by c.created_at desc),'[]'::jsonb)
 into v_rows
 from public.v4_account_contacts c
 left join public.profiles p
   on p.id=(case when c.teacher_id=v_actor then c.parent_id else c.teacher_id end)
 where c.teacher_id=v_actor or c.parent_id=v_actor;
 return v_rows;
end $$;
revoke all on function public.v4_contact_inbox() from public,anon;
grant execute on function public.v4_contact_inbox() to authenticated;

create function public.v4_contact_action(p_id uuid,p_action text)
returns text language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_link public.v4_account_contacts%rowtype; v_next text;
begin
 if v_actor is null then raise exception '請先登入'; end if;
 if p_action is null or p_action not in ('approve','decline','cancel','disconnect') then
  raise exception '不支援的操作';
 end if;
 select * into v_link from public.v4_account_contacts c where c.id=p_id for update;
 if not found or v_actor not in (v_link.teacher_id,v_link.parent_id) then
   raise exception '連結不存在或無權操作';
 end if;
 if p_action='approve' then
   if v_link.status<>'pending' or v_link.requested_by=v_actor then
     raise exception '只能由受邀人接受尚未處理的邀請';
   end if;
   v_next:='connected';
 elsif p_action='decline' then
   if v_link.status<>'pending' or v_link.requested_by=v_actor then
     raise exception '只能由受邀人婉拒尚未處理的邀請';
   end if;
   v_next:='declined';
 elsif p_action='cancel' then
   if v_link.status<>'pending' or v_link.requested_by<>v_actor then
     raise exception '只能撤回自己尚未處理的邀請';
   end if;
   v_next:='cancelled';
 else
   if v_link.status<>'connected' then
     raise exception '只能解除已連結的聯絡人';
   end if;
   v_next:='disconnected';
 end if;
 update public.v4_account_contacts set status=v_next,updated_at=now() where id=p_id;
 return v_next;
end $$;
revoke all on function public.v4_contact_action(uuid,text) from public,anon;
grant execute on function public.v4_contact_action(uuid,text) to authenticated;

-- NEVER add an RLS policy on students, lesson_records, payment_batches,
-- payment_batch_items, family_requests or student_guardians based on this table.
