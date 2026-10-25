-- Close cross-tenant reads and require a guardian invitation to match the exact linked student and teacher.
drop policy if exists no_fake_request_dates_only_valid_schedule on public.recurring_schedules;

drop policy if exists links_guardian_claim_invite on public.student_guardians;
create policy links_guardian_claim_invite on public.student_guardians
for insert to authenticated
with check (
 guardian_id = (select auth.uid())
 and exists (
  select 1 from public.guardian_invites i
  where i.id = student_guardians.invite_id
    and i.student_id = student_guardians.student_id
    and i.teacher_id = student_guardians.teacher_id
    and lower(i.email) = lower((select auth.jwt() ->> 'email'))
 )
);

drop policy if exists requests_guardian_create on public.family_requests;
create policy requests_guardian_create on public.family_requests
for insert to authenticated
with check (
 parent_id = (select auth.uid())
 and status = 'pending'
 and reviewed_at is null
 and exists (
  select 1 from public.student_guardians g
  where g.student_id = family_requests.student_id
    and g.teacher_id = family_requests.teacher_id
    and g.guardian_id = (select auth.uid())
 )
 and (
  (
   lesson_id is not null
   and schedule_id is null
   and scheduled_date is null
   and exists (
    select 1 from public.lesson_records l
    where l.id = family_requests.lesson_id
     and l.owner_id = family_requests.teacher_id
     and l.student_id = family_requests.student_id
     and (
      (family_requests.kind = 'time_correction' and l.type = 'lesson')
      or (family_requests.kind = 'payment' and l.type = 'lesson')
      or (family_requests.kind = 'leave' and l.type in ('planned','lesson'))
     )
   )
  )
  or
  (
   lesson_id is null
   and schedule_id is not null
   and scheduled_date is not null
   and kind = 'leave'
   and exists (
    select 1 from public.recurring_schedules s
    where s.id = family_requests.schedule_id
     and s.teacher_id = family_requests.teacher_id
     and s.student_id = family_requests.student_id
     and family_requests.scheduled_date >= s.starts_on
     and (s.ends_on is null or family_requests.scheduled_date <= s.ends_on)
     and extract(isodow from family_requests.scheduled_date)::smallint = any(s.weekdays)
     and (((family_requests.scheduled_date -
         (s.starts_on - (extract(isodow from s.starts_on)::int - 1))) / 7)::int % s.every_weeks) = 0
   )
  )
 )
);
