-- V3.2: student access is invitation-gated and read-only; no direct access to money tables.
alter table public.profiles add column if not exists last_role text;
alter table public.profiles drop constraint if exists profiles_last_role_check;
alter table public.profiles add constraint profiles_last_role_check
 check(last_role is null or last_role in ('teacher','parent','student'));

create table if not exists public.student_invites(
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id),
 student_id uuid not null,
 email text not null check(email=lower(btrim(email))),
 created_at timestamptz not null default now(),
 unique(student_id,email),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create table if not exists public.student_links(
 id uuid primary key default gen_random_uuid(),
 invite_id uuid not null unique references public.student_invites(id) on delete cascade,
 teacher_id uuid not null,
 student_id uuid not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(student_id,user_id),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create index if not exists student_links_user_idx on public.student_links(user_id,student_id);
alter table public.student_invites enable row level security;
alter table public.student_links enable row level security;
revoke all on public.student_invites,public.student_links from public,anon,authenticated;
grant select,insert,delete on public.student_invites to authenticated;
grant select,delete on public.student_links to authenticated;
create policy student_invites_teacher_or_recipient_select on public.student_invites
 for select to authenticated using(
  teacher_id=(select auth.uid()) or
  (email=lower(((select auth.jwt())->>'email')) and (select auth.uid()) is not null)
 );
create policy student_invites_teacher_insert on public.student_invites
 for insert to authenticated with check(
  teacher_id=(select auth.uid()) and exists(
   select 1 from public.students s where s.id=student_id and s.teacher_id=(select auth.uid())
  )
 );
create policy student_invites_teacher_delete on public.student_invites
 for delete to authenticated using(teacher_id=(select auth.uid()));
create policy student_links_teacher_or_self_select on public.student_links
 for select to authenticated using(teacher_id=(select auth.uid()) or user_id=(select auth.uid()));
create policy student_links_teacher_or_self_delete on public.student_links
 for delete to authenticated using(teacher_id=(select auth.uid()) or user_id=(select auth.uid()));

-- Student claim checks Google email AND original invitation; account cannot self-select another student.
create or replace function public.claim_student_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.student_invites%rowtype;
begin
 if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
 select * into v from public.student_invites where id=p_invite_id for share;
 if not found or v.email<>lower(coalesce(((select auth.jwt())->>'email'),'')) then
  raise exception 'No invitation for this account';
 end if;
 insert into public.student_links(invite_id,teacher_id,student_id,user_id)
 values(v.id,v.teacher_id,v.student_id,(select auth.uid()))
 on conflict (student_id,user_id) do nothing;
end;$$;
revoke all on function public.claim_student_invite(uuid) from public,anon;
grant execute on function public.claim_student_invite(uuid) to authenticated;

-- Deliberately returns no payment amounts, rates, parent details, or other students.
-- Bypass is narrowly contained in this function; links are rechecked every request.
create or replace function public.student_portal_data()
returns jsonb language sql stable security definer set search_path=''
as $$
select jsonb_build_object(
 'students',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'teacher_id',s.teacher_id,'subject',s.subject))
   from public.student_links sl join public.students s on s.id=sl.student_id
   where sl.user_id=(select auth.uid())), '[]'::jsonb),
 'lessons',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'student_id',l.student_id,'lesson_date',l.lesson_date,
   'subject',l.subject,'start_time',l.start_time,'end_time',l.end_time,
   'type',l.type,'remarks',l.remarks,'focus_rating',l.focus_rating,
   'attitude_rating',l.attitude_rating,'hours',l.hours))
   from public.lesson_records l join public.student_links sl on sl.student_id=l.student_id
   where sl.user_id=(select auth.uid())), '[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(jsonb_build_object(
   'id',r.id,'student_id',r.student_id,'subject',r.subject,
   'starts_on',r.starts_on,'ends_on',r.ends_on,'cancelled_from',r.cancelled_from,
   'weekdays',r.weekdays,'every_weeks',r.every_weeks,
   'start_time',r.start_time,'end_time',r.end_time))
   from public.recurring_schedules r join public.student_links sl on sl.student_id=r.student_id
   where sl.user_id=(select auth.uid())), '[]'::jsonb)
);
$$;
revoke all on function public.student_portal_data() from public,anon;
grant execute on function public.student_portal_data() to authenticated;
