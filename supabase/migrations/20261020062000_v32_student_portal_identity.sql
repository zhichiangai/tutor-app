-- V3 Student portal: invite-only access, no raw finance/guardian records for student accounts.
-- The RPC below is deliberately narrow SECURITY DEFINER: student users must never be
-- granted direct SELECT on lesson_records, which contains financial/private family data.
alter table public.profiles add column if not exists last_role text not null default 'teacher'
 check (last_role in ('teacher','parent','student'));
grant update(last_role) on public.profiles to authenticated;

create table if not exists public.student_invitations (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null,
 teacher_id uuid not null references auth.users(id) on delete cascade,
 email text not null check(email = lower(btrim(email)) and length(email) between 5 and 254),
 created_at timestamptz not null default now(),
 unique(student_id,email),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create table if not exists public.student_links (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null,
 teacher_id uuid not null references auth.users(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 invitation_id uuid not null references public.student_invitations(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(student_id,user_id),
 unique(invitation_id),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create index if not exists student_links_user_idx on public.student_links(user_id,student_id);
create index if not exists student_invites_email_idx on public.student_invitations(email);

alter table public.student_invitations enable row level security;
alter table public.student_links enable row level security;
revoke all on public.student_invitations,public.student_links from public,anon,authenticated;
grant select,insert,delete on public.student_invitations to authenticated;
grant update(email) on public.student_invitations to authenticated;
grant select,insert on public.student_links to authenticated;
-- The invite is the sole revocation source. Deleting it cascades to student_links.
create policy student_invites_teacher_or_email_read on public.student_invitations
 for select to authenticated using (
 teacher_id=(select auth.uid())
 or email=lower((select auth.jwt())->>'email')
);
create policy student_invites_teacher_insert on public.student_invitations
 for insert to authenticated with check (
 teacher_id=(select auth.uid()) and
 exists(select 1 from public.students s
        where s.id=student_id and s.teacher_id=(select auth.uid()))
);
create policy student_invites_teacher_revoke on public.student_invitations
 for delete to authenticated using (teacher_id=(select auth.uid()));
create policy student_invites_teacher_edit_pending on public.student_invitations
 for update to authenticated
 using (teacher_id=(select auth.uid()) and
        not exists(select 1 from public.student_links l where l.invitation_id=id))
 with check (teacher_id=(select auth.uid()) and
        not exists(select 1 from public.student_links l where l.invitation_id=id));
create policy student_links_self_or_teacher_read on public.student_links
 for select to authenticated
 using (user_id=(select auth.uid()) or teacher_id=(select auth.uid()));
create policy student_links_invitee_accept on public.student_links
 for insert to authenticated with check (
 user_id=(select auth.uid()) and
 exists(select 1 from public.student_invitations i
  where i.id=invitation_id and i.student_id=student_id
    and i.teacher_id=teacher_id
    and i.email=lower((select auth.jwt())->>'email'))
);

-- A safe student-specific snapshot. No rate, payment, guardian identity or private
-- parent notes are returned. Grant only EXECUTE, never base-table SELECT for students.
create or replace function public.student_portal_snapshot()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
select jsonb_build_object(
 'students',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',s.id,'name',s.name,'subject',s.subject,'teacher_id',s.teacher_id
   ) order by s.name)
   from public.students s join public.student_links l
     on l.student_id=s.id and l.teacher_id=s.teacher_id
   where l.user_id=(select auth.uid())
 ),'[]'::jsonb),
 'lessons',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',r.id,'student_id',r.student_id,'owner_id',r.owner_id,'student',r.student,
     'subject',r.subject,'lesson_date',r.lesson_date,'start_time',r.start_time,
     'end_time',r.end_time,'actual_start_time',r.actual_start_time,
     'actual_end_time',r.actual_end_time,'hours',r.hours,'actual_hours',r.actual_hours,
     'type',r.type,'leave_source',r.leave_source,
     'schedule_id',r.schedule_id,'scheduled_date',r.scheduled_date,
     'remarks',r.remarks,'focus_rating',r.focus_rating,
     'attitude_rating',r.attitude_rating
   ) order by r.lesson_date desc)
   from public.lesson_records r join public.student_links l
     on l.student_id=r.student_id and l.teacher_id=r.owner_id
   where l.user_id=(select auth.uid())
 ),'[]'::jsonb),
 'schedules',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',r.id,'student_id',r.student_id,'teacher_id',r.teacher_id,'subject',r.subject,
     'weekdays',r.weekdays,'every_weeks',r.every_weeks,
     'starts_on',r.starts_on,'ends_on',r.ends_on,'cancelled_from',r.cancelled_from,
     'start_time',r.start_time,'end_time',r.end_time
   ))
   from public.recurring_schedules r join public.student_links l
     on l.student_id=r.student_id and l.teacher_id=r.teacher_id
   where l.user_id=(select auth.uid())
 ),'[]'::jsonb),
 'exceptions',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',e.id,'teacher_id',e.teacher_id,'schedule_id',e.schedule_id,
     'original_date',e.original_date,'action',e.action,
     'moved_to',e.moved_to,'remarks',e.remarks
   ))
   from public.schedule_exceptions e
    join public.recurring_schedules r on r.id=e.schedule_id and r.teacher_id=e.teacher_id
    join public.student_links l on l.student_id=r.student_id and l.teacher_id=r.teacher_id
   where l.user_id=(select auth.uid())
 ),'[]'::jsonb)
)
where (select auth.uid()) is not null;
$$;
revoke all on function public.student_portal_snapshot() from public,anon;
grant execute on function public.student_portal_snapshot() to authenticated;
comment on function public.student_portal_snapshot() is
 'Deliberately restricted security-definer student read API: verifies current auth.uid() against teacher-authorized student_links on every request. Never includes financial/private guardian data.';
