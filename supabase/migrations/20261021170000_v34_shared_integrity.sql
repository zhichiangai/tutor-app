-- V3.4: authoritative schedule integrity helpers.
-- Privileged routines are kept in the non-exposed tutor_private schema.
create or replace function tutor_private.v34_occurs(
 p_start date, p_end date, p_cancel date, p_days smallint[],
 p_frequency smallint, p_day date
) returns boolean language sql immutable set search_path='' as $$
 select coalesce(
   p_day >= p_start
   and (p_end is null or p_day <= p_end)
   and (p_cancel is null or p_day < p_cancel)
   and extract(isodow from p_day)::smallint = any(p_days)
   and (
     ((date_trunc('week',p_day::timestamp)::date -
       date_trunc('week',p_start::timestamp)::date) / 7)
     % greatest(p_frequency,1) = 0
   ), false);
$$;
revoke all on function tutor_private.v34_occurs(date,date,date,smallint[],smallint,date)
 from public,anon,authenticated;

-- Reuse this for a single proposed lesson or a shifted occurrence.
-- Both student and teacher calendars are checked. A materialized occurrence
-- replaces its virtual schedule entry; cancellations do not block time.
create or replace function tutor_private.v34_has_conflict(
 p_teacher uuid, p_student uuid, p_date date, p_start text, p_end text,
 p_ignore_lesson uuid default null,
 p_ignore_occurrence_rule uuid default null,
 p_ignore_occurrence_date date default null,
 p_superseded_rule uuid default null,
 p_superseded_from date default null
) returns boolean language sql stable security definer set search_path='' as $$
 select
 exists (
   select 1 from public.lesson_records l
   where (l.owner_id=p_teacher or l.student_id=p_student)
     and l.type not in ('leave','moved')
     and l.lesson_date=p_date
     and l.start_time<p_end and l.end_time>p_start
     and (p_ignore_lesson is null or l.id<>p_ignore_lesson)
     and not (p_superseded_rule is not null and l.schedule_id=p_superseded_rule
              and l.scheduled_date >= p_superseded_from and l.type='planned')
 )
 or exists (
   select 1 from public.recurring_schedules r
   where (r.teacher_id=p_teacher or r.student_id=p_student)
     and r.start_time<p_end and r.end_time>p_start
     and tutor_private.v34_occurs(r.starts_on,r.ends_on,r.cancelled_from,
       r.weekdays,r.every_weeks,p_date)
     and not (p_ignore_occurrence_rule is not null and r.id=p_ignore_occurrence_rule
              and p_date=p_ignore_occurrence_date)
     and not (p_superseded_rule is not null and r.id=p_superseded_rule
              and p_date>=p_superseded_from)
     and not exists (
       select 1 from public.lesson_records l
       where l.schedule_id=r.id and l.scheduled_date=p_date)
     and not exists (
       select 1 from public.schedule_exceptions e
       where e.schedule_id=r.id and e.original_date=p_date
         and e.action in ('teacher_leave','student_leave','reschedule'))
 )
 or exists (
   select 1 from public.schedule_exceptions e
   join public.recurring_schedules r on r.id=e.schedule_id
   where (r.teacher_id=p_teacher or r.student_id=p_student)
     and e.action='reschedule' and e.moved_to=p_date
     and r.start_time<p_end and r.end_time>p_start
     and tutor_private.v34_occurs(r.starts_on,r.ends_on,r.cancelled_from,
       r.weekdays,r.every_weeks,e.original_date)
     and not (p_ignore_occurrence_rule is not null and r.id=p_ignore_occurrence_rule
              and e.original_date=p_ignore_occurrence_date)
     and not (p_superseded_rule is not null and r.id=p_superseded_rule
              and e.original_date>=p_superseded_from)
     and not exists (
       select 1 from public.lesson_records l
       where l.schedule_id=r.id and l.scheduled_date=e.original_date)
 );
$$;
revoke all on function tutor_private.v34_has_conflict(uuid,uuid,date,text,text,uuid,uuid,date,uuid,date)
 from public,anon,authenticated;

-- New recurring patterns must not overlap existing materialized classes
-- nor any other perpetual weekly/biweekly rule. Recurrence patterns repeat
-- every 14 days, so probing the first 14 days after two rules begin to coexist
-- is sufficient regardless of how far in the future that overlap starts.
create or replace function tutor_private.v34_assert_schedule_available(
 p_teacher uuid, p_student uuid, p_starts date, p_ends date,
 p_days smallint[], p_every smallint, p_start_time text, p_end_time text,
 p_ignored_rule uuid default null
) returns void language plpgsql stable security definer set search_path='' as $$
declare v_conflict date;
begin
 select l.lesson_date into v_conflict
 from public.lesson_records l
 where (l.owner_id=p_teacher or l.student_id=p_student)
   and l.type not in ('leave','moved')
   and l.start_time<p_end_time and l.end_time>p_start_time
   and not (p_ignored_rule is not null and l.schedule_id=p_ignored_rule
            and l.scheduled_date>=p_starts and l.type='planned')
   and tutor_private.v34_occurs(p_starts,p_ends,null,p_days,p_every,l.lesson_date)
 limit 1;
 if found then
   raise exception '課程時間衝突：% 已有其他已安排課程',v_conflict;
 end if;

 select d.day::date into v_conflict
 from public.recurring_schedules r
 cross join lateral generate_series(
   greatest(p_starts,r.starts_on)::timestamp,
   greatest(p_starts,r.starts_on)::timestamp + interval '13 days',
   interval '1 day') d(day)
 where (r.teacher_id=p_teacher or r.student_id=p_student)
   and (p_ignored_rule is null or r.id<>p_ignored_rule)
   and r.start_time<p_end_time and r.end_time>p_start_time
   and tutor_private.v34_occurs(p_starts,p_ends,null,p_days,p_every,d.day::date)
   and tutor_private.v34_occurs(r.starts_on,r.ends_on,r.cancelled_from,
       r.weekdays,r.every_weeks,d.day::date)
 limit 1;
 if found then
   raise exception '固定課表時間衝突：% 與現有固定課表重疊',v_conflict;
 end if;

 select e.moved_to into v_conflict
 from public.schedule_exceptions e
 join public.recurring_schedules r on r.id=e.schedule_id
 where (r.teacher_id=p_teacher or r.student_id=p_student)
   and (p_ignored_rule is null or r.id<>p_ignored_rule)
   and e.action='reschedule' and e.moved_to is not null
   and r.start_time<p_end_time and r.end_time>p_start_time
   and tutor_private.v34_occurs(r.starts_on,r.ends_on,r.cancelled_from,
       r.weekdays,r.every_weeks,e.original_date)
   and not exists (
     select 1 from public.lesson_records l
     where l.schedule_id=r.id and l.scheduled_date=e.original_date)
   and tutor_private.v34_occurs(p_starts,p_ends,null,p_days,p_every,e.moved_to)
 limit 1;
 if found then
   raise exception '固定課表與已改期課程撞期：%',v_conflict;
 end if;
end;$$;
revoke all on function tutor_private.v34_assert_schedule_available(uuid,uuid,date,date,smallint[],smallint,text,text,uuid)
 from public,anon,authenticated;

-- Existing updates without explicit version validation from legacy teacher forms
-- still advance their timestamps, so family snapshots detect these modifications.
create or replace function tutor_private.v34_revision_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   new.updated_at:=greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v34_revision_stamp()
 from public,anon,authenticated;
drop trigger if exists trg_v34_lesson_revision on public.lesson_records;
create trigger trg_v34_lesson_revision before update on public.lesson_records
 for each row execute function tutor_private.v34_revision_stamp();
drop trigger if exists trg_v34_schedule_revision on public.recurring_schedules;
create trigger trg_v34_schedule_revision before update on public.recurring_schedules
 for each row execute function tutor_private.v34_revision_stamp();

-- Dedicated audit metadata keeps "which account clicked cancel" separate
-- from whether a lesson was teacher-side or student-side leave.
alter table tutor_private.shared_course_events
 add column if not exists actor_role text,
 add column if not exists cancellation_source text,
 add column if not exists cancellation_reason text;

-- Exactly one read policy is sufficient. Both previously had identical
-- teacher_id/user_id predicates; keep student_links_teacher_or_self_select.
drop policy if exists student_links_self_or_teacher_read on public.student_links;
