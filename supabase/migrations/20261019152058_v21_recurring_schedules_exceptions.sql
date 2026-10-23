
create table public.recurring_schedules (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id) on delete cascade,
 student_id uuid not null,
 subject text not null,
 weekdays smallint[] not null check(cardinality(weekdays)>0 and weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
 every_weeks smallint not null default 1 check(every_weeks in (1,2)),
 starts_on date not null,
 ends_on date,
 start_time text not null check(start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 end_time text not null check(end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time>start_time),
 hourly_rate numeric(12,2) not null check(hourly_rate>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (ends_on is null or ends_on>=starts_on),
 unique(id,teacher_id),
 foreign key(student_id,teacher_id) references public.students(id,teacher_id) on delete cascade
);
create index recurring_schedule_student on public.recurring_schedules(student_id,starts_on);
alter table public.recurring_schedules enable row level security;
revoke all on public.recurring_schedules from anon;
grant select,insert,update,delete on public.recurring_schedules to authenticated;
create policy "recurring_teacher_or_guardian_read" on public.recurring_schedules for select to authenticated using (
 teacher_id=(select auth.uid()) or exists(select 1 from public.student_guardians g where g.student_id=recurring_schedules.student_id and g.guardian_id=(select auth.uid()))
);
create policy "recurring_teacher_insert" on public.recurring_schedules for insert to authenticated with check(teacher_id=(select auth.uid()));
create policy "recurring_teacher_update" on public.recurring_schedules for update to authenticated using(teacher_id=(select auth.uid())) with check(teacher_id=(select auth.uid()));
create policy "recurring_teacher_delete" on public.recurring_schedules for delete to authenticated using(teacher_id=(select auth.uid()));

alter table public.lesson_records
 add column schedule_id uuid references public.recurring_schedules(id) on delete set null,
 add column scheduled_date date;
create unique index lesson_occurrence_unique on public.lesson_records(schedule_id,scheduled_date)
 where schedule_id is not null and scheduled_date is not null;
alter table public.lesson_records add constraint lesson_occurrence_complete check (
 (schedule_id is null and scheduled_date is null) or (schedule_id is not null and scheduled_date is not null)
);

create table public.schedule_exceptions (
 id uuid primary key default gen_random_uuid(),
 schedule_id uuid not null,
 teacher_id uuid not null references auth.users(id) on delete cascade,
 original_date date not null,
 action text not null check(action in ('student_leave','teacher_leave','reschedule')),
 moved_to date,
 remarks text not null default '',
 created_at timestamptz not null default now(),
 foreign key (schedule_id,teacher_id) references public.recurring_schedules(id,teacher_id) on delete cascade,
 unique(schedule_id,original_date),
 check((action='reschedule' and moved_to is not null and moved_to<>original_date) or (action<>'reschedule' and moved_to is null))
);
create index schedule_exceptions_teacher on public.schedule_exceptions(teacher_id,schedule_id,original_date);
alter table public.schedule_exceptions enable row level security;
revoke all on public.schedule_exceptions from anon;
grant select,insert,update,delete on public.schedule_exceptions to authenticated;
create policy "exception_teacher_or_guardian_read" on public.schedule_exceptions for select to authenticated using (
 teacher_id=(select auth.uid()) or exists(select 1 from public.recurring_schedules r join public.student_guardians g on g.student_id=r.student_id where r.id=schedule_exceptions.schedule_id and g.guardian_id=(select auth.uid()))
);
create policy "exception_teacher_insert" on public.schedule_exceptions for insert to authenticated with check(teacher_id=(select auth.uid()));
create policy "exception_teacher_update" on public.schedule_exceptions for update to authenticated using(teacher_id=(select auth.uid())) with check(teacher_id=(select auth.uid()));
create policy "exception_teacher_delete" on public.schedule_exceptions for delete to authenticated using(teacher_id=(select auth.uid()));

alter table public.family_requests
 add column schedule_id uuid references public.recurring_schedules(id) on delete set null,
 add column scheduled_date date;
create policy "no_fake_request_dates_only_valid_schedule" on public.recurring_schedules as restrictive for select to authenticated using(true);
drop policy "requests_guardian_create" on public.family_requests;
create policy "requests_guardian_create" on public.family_requests for insert to authenticated with check (
 parent_id=(select auth.uid()) and status='pending' and
 exists(select 1 from public.student_guardians g where g.student_id=family_requests.student_id and g.teacher_id=family_requests.teacher_id and g.guardian_id=(select auth.uid())) and
 (
 (lesson_id is not null and schedule_id is null and exists(select 1 from public.lesson_records l where l.id=lesson_id and l.owner_id=teacher_id and l.student_id=student_id))
 or
 (lesson_id is null and schedule_id is not null and scheduled_date is not null and kind='leave' and exists(
  select 1 from public.recurring_schedules r where r.id=schedule_id and r.teacher_id=family_requests.teacher_id
  and r.student_id=family_requests.student_id and scheduled_date >= r.starts_on and (r.ends_on is null or scheduled_date<=r.ends_on)
 ))
 )
);
create unique index request_virtual_pending_unique on public.family_requests(parent_id,schedule_id,scheduled_date,kind)
 where status='pending' and schedule_id is not null;
