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

create or replace function public.shared_course_action(
  p_action text, p_student_id uuid, p_target_id uuid default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_st public.students%rowtype;
  v_l public.lesson_records%rowtype;
  v_r public.recurring_schedules%rowtype;
  v_date date;
  v_effective date;
  v_subject text;
  v_start text;
  v_end text;
  v_hours numeric;
  v_weekdays integer[];
  v_frequency integer;
  v_enddate date;
  v_id uuid;
  v_summary text;
  v_actor_role text;
  v_cancel_source text;
  v_cancel_reason text;
begin
  if v_actor is null or p_student_id is null then
    raise exception '請先登入並選擇學生';
  end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception '參數格式不正確';
  end if;
  select * into v_st from public.students where id=p_student_id;
  if not found or not (
    v_st.teacher_id=v_actor
    or exists(select 1 from public.student_guardians g
        where g.student_id=v_st.id and g.teacher_id=v_st.teacher_id and g.guardian_id=v_actor)
    or exists(select 1 from public.student_links sl
        where sl.student_id=v_st.id and sl.teacher_id=v_st.teacher_id and sl.user_id=v_actor)
  ) then
    raise exception '你沒有管理這位學生課程的權限';
  end if;
  -- Serialize mutations for the same teacher, including independent students.
  -- Direct teacher legacy CRUD is not subject to this advisory lock.
  perform pg_advisory_xact_lock(hashtextextended(v_st.teacher_id::text,42034));
  v_actor_role:=case when v_actor=v_st.teacher_id then 'teacher'
    when exists(select 1 from public.student_guardians g
      where g.student_id=v_st.id and g.teacher_id=v_st.teacher_id and g.guardian_id=v_actor)
      then 'guardian' else 'student' end;
  v_cancel_source:=coalesce(nullif(p_payload->>'cancellation_source',''),
    case when v_actor_role='teacher' then 'teacher' else 'student' end);
  if v_cancel_source not in ('teacher','student') or
    (v_cancel_source='teacher' and v_actor_role<>'teacher') then
    raise exception '取消來源不可指定為未授權的身分';
  end if;
  v_cancel_reason:=nullif(btrim(coalesce(p_payload->>'cancellation_reason','')),'');
  if length(coalesce(v_cancel_reason,''))>200 then
    raise exception '取消原因不可超過 200 字';
  end if;

  if p_action in ('create_lesson','update_lesson','create_schedule','update_schedule','change_occurrence') then
    v_subject:=btrim(coalesce(p_payload->>'subject',v_st.subject));
    v_start:=p_payload->>'start_time';
    v_end:=p_payload->>'end_time';
    if v_subject is null or length(v_subject) not between 1 and 80 then
      raise exception '請填寫正確科目';
    end if;
    if v_start is null or v_end is null
       or v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or v_end<=v_start then
      raise exception '請確認上課開始、結束時間';
    end if;
    v_hours:=(split_part(v_end,':',1)::numeric*60+split_part(v_end,':',2)::numeric-
              split_part(v_start,':',1)::numeric*60-split_part(v_start,':',2)::numeric)/60;
    if v_hours>16 then raise exception '單堂課不可超過 16 小時'; end if;
    if p_action in ('create_lesson','update_lesson') then
      v_date:=(p_payload->>'lesson_date')::date;
      if v_date is null then raise exception '請選擇上課日期'; end if;
    end if;
  end if;

  if p_action='create_lesson' then
    if tutor_private.v34_has_conflict(
      v_st.teacher_id,v_st.id,v_date,v_start,v_end) then
      raise exception '課程時間衝突：同一學生或老師在此時段已經有其他課程';
    end if;
    insert into public.lesson_records(owner_id,student_id,student,lesson_date,subject,
      start_time,end_time,hours,hourly_rate,total_amount,type,status)
    values(v_st.teacher_id,v_st.id,v_st.name,v_date,v_subject,v_start,v_end,
      round(v_hours,2),v_st.hourly_rate,round(v_hours*v_st.hourly_rate,2),'planned','未付款')
    returning id into v_id;
    v_summary:='新增單堂課 '||v_date::text||' '||v_subject;

  elsif p_action in ('update_lesson','cancel_lesson') then
    select * into v_l from public.lesson_records
      where id=p_target_id and student_id=v_st.id and owner_id=v_st.teacher_id for update;
    if not found or v_l.type<>'planned' or v_l.status<>'未付款'
       or exists(select 1 from public.payment_batch_items b where b.lesson_id=v_l.id)
       or exists(select 1 from public.family_requests f where f.lesson_id=v_l.id and f.status='pending')
    then raise exception '課程不存在、已完成或已進入帳務／申請流程，不能直接修改'; end if;
    if nullif(p_payload->>'expected_updated_at','') is null
      or v_l.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then
      raise exception '課程版本已變更或缺少版本資料，請重新整理';
    end if;
    if p_action='update_lesson' then
      if tutor_private.v34_has_conflict(
        v_st.teacher_id,v_st.id,v_date,v_start,v_end,v_l.id) then
        raise exception '課程時間衝突：同一學生或老師在此時段已有其他課程';
      end if;
      update public.lesson_records set lesson_date=v_date,subject=v_subject,
        start_time=v_start,end_time=v_end,hours=round(v_hours,2),
        total_amount=round(v_hours*v_l.hourly_rate,2),updated_at=now()
        where id=v_l.id;
      v_summary:='調整單堂課 '||v_date::text||' '||v_subject;
    else
      update public.lesson_records set type='leave',leave_source=v_cancel_source,
        hours=0,total_amount=0,actual_hours=null,actual_start_time=null,
        actual_end_time=null,updated_at=now()
        where id=v_l.id;
      v_summary:='取消單堂課 '||v_l.lesson_date::text||' '||v_l.subject;
    end if;
    v_id:=v_l.id;

  elsif p_action in ('create_schedule','update_schedule') then
    if jsonb_typeof(p_payload->'weekdays')<>'array' then raise exception '請選擇上課星期'; end if;
    select array_agg(distinct n order by n) into v_weekdays
      from jsonb_array_elements_text(p_payload->'weekdays') x(day_text),
           lateral (select x.day_text::integer as n) t
      where n between 1 and 7;
    if coalesce(array_length(v_weekdays,1),0)<1
       or jsonb_array_length(p_payload->'weekdays')<>array_length(v_weekdays,1)
       then raise exception '上課星期必須在週一到週日之間且不能重複'; end if;
    v_frequency:=coalesce((p_payload->>'every_weeks')::integer,1);
    if v_frequency not in (1,2) then raise exception '只支援每週與雙週'; end if;
    v_date:=(p_payload->>'starts_on')::date;
    v_enddate:=nullif(p_payload->>'ends_on','')::date;
    if v_date is null or (v_enddate is not null and v_enddate<v_date)
       then raise exception '固定課表日期不正確'; end if;
    if p_action='create_schedule' then
      perform tutor_private.v34_assert_schedule_available(
         v_st.teacher_id,v_st.id,v_date,v_enddate,v_weekdays::smallint[],
         v_frequency::smallint,v_start,v_end);
      insert into public.recurring_schedules(teacher_id,student_id,subject,weekdays,
        every_weeks,starts_on,ends_on,start_time,end_time,hourly_rate)
      values(v_st.teacher_id,v_st.id,v_subject,v_weekdays,v_frequency,
        v_date,v_enddate,v_start,v_end,v_st.hourly_rate) returning id into v_id;
      v_summary:='新增固定課表 '||v_subject||' '||v_date::text;
    else
      select * into v_r from public.recurring_schedules
        where id=p_target_id and student_id=v_st.id and teacher_id=v_st.teacher_id for update;
      if not found then raise exception '找不到固定課表'; end if;
      if nullif(p_payload->>'expected_updated_at','') is null
        or v_r.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then
        raise exception '固定課表版本已變更或缺少版本資料，請重新整理';
      end if;
      v_effective:=nullif(p_payload->>'effective_on','')::date;
      if v_effective is null then raise exception '請選擇修改起始日'; end if;
      if v_effective<v_r.starts_on or v_effective<current_date
         or (v_r.ends_on is not null and v_effective>v_r.ends_on)
         then raise exception '只可從今天或以後的有效課表日期修改'; end if;
      if v_enddate is not null and v_enddate<v_effective then raise exception '結束日不可早於生效日'; end if;
      if exists(select 1 from public.lesson_records l
         where l.schedule_id=v_r.id and l.scheduled_date>=v_effective
          and (l.type='lesson' or l.status<>'未付款'
            or exists(select 1 from public.payment_batch_items b where b.lesson_id=l.id)
            or exists(select 1 from public.family_requests f where f.lesson_id=l.id and f.status='pending')))
         then raise exception '未來課程已有完成或付款紀錄，請先處理'; end if;
      perform tutor_private.v34_assert_schedule_available(
         v_st.teacher_id,v_st.id,v_effective,v_enddate,v_weekdays::smallint[],
         v_frequency::smallint,v_start,v_end,v_r.id);
      update public.recurring_schedules
        set cancelled_from=v_effective,updated_at=now()
        where id=v_r.id;
      update public.lesson_records set type='leave',leave_source=null,hours=0,
         total_amount=0,actual_hours=null,actual_start_time=null,actual_end_time=null,
         updated_at=now()
        where schedule_id=v_r.id and scheduled_date>=v_effective and type='planned';
      insert into public.recurring_schedules(teacher_id,student_id,subject,weekdays,
        every_weeks,starts_on,ends_on,start_time,end_time,hourly_rate)
      values(v_st.teacher_id,v_st.id,v_subject,v_weekdays,v_frequency,
        v_effective,v_enddate,v_start,v_end,v_r.hourly_rate) returning id into v_id;
      v_summary:='自 '||v_effective::text||' 起修改固定課表 '||v_subject;
    end if;

  elsif p_action='cancel_schedule' then
    select * into v_r from public.recurring_schedules
      where id=p_target_id and student_id=v_st.id and teacher_id=v_st.teacher_id for update;
    if not found then raise exception '找不到固定課表'; end if;
    if nullif(p_payload->>'expected_updated_at','') is null
      or v_r.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then
      raise exception '固定課表版本已變更或缺少版本資料，請重新整理';
    end if;
    v_effective:=coalesce(nullif(p_payload->>'from_date','')::date,v_r.starts_on);
    -- Preserve past lesson history even when the user selects "stop entire series".
    v_effective:=greatest(v_effective,v_r.starts_on,current_date);
    if v_r.ends_on is not null and v_effective>v_r.ends_on then
      raise exception '所選日期超出課表範圍'; end if;
    if exists(select 1 from public.lesson_records l
       where l.schedule_id=v_r.id and l.scheduled_date>=v_effective
         and l.type='planned'
         and (l.status<>'未付款'
            or exists(select 1 from public.payment_batch_items b where b.lesson_id=l.id)
            or exists(select 1 from public.family_requests f where f.lesson_id=l.id and f.status='pending')))
      then raise exception '未來課程已進入帳務流程，不能取消'; end if;
    v_effective:=greatest(current_date,least(v_effective,coalesce(v_r.cancelled_from,v_effective)));
    update public.recurring_schedules set cancelled_from=v_effective,updated_at=now()
      where id=v_r.id;
    update public.lesson_records set type='leave',leave_source=v_cancel_source,hours=0,
       total_amount=0,actual_hours=null,actual_start_time=null,actual_end_time=null,updated_at=now()
      where schedule_id=v_r.id and scheduled_date>=v_effective and type='planned';
    v_id:=v_r.id;
    v_summary:='停止固定課表 '||v_effective::text;

  elsif p_action in ('change_occurrence','cancel_occurrence') then
    select * into v_r from public.recurring_schedules
      where id=p_target_id and student_id=v_st.id and teacher_id=v_st.teacher_id for update;
    if not found then raise exception '找不到固定課表'; end if;
    if nullif(p_payload->>'expected_updated_at','') is null
       or v_r.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then
       raise exception '固定課表單堂版本已變更或缺少版本資料，請重新整理';
    end if;
    v_date:=(p_payload->>'original_date')::date;
    if not tutor_private.v34_occurs(
       v_r.starts_on,v_r.ends_on,v_r.cancelled_from,v_r.weekdays,v_r.every_weeks,v_date)
       then raise exception '這天不是有效的固定上課日（請檢查雙週間隔）'; end if;
    if exists(select 1 from public.lesson_records l where l.schedule_id=v_r.id
       and l.scheduled_date=v_date) then
       raise exception '這堂課已有獨立紀錄，請從課程清單修改'; end if;
    if p_action='change_occurrence' then
      v_effective:=(p_payload->>'moved_to')::date;
      if v_effective is null or v_effective=v_date then raise exception '請指定不同的補課日期'; end if;
      if tutor_private.v34_has_conflict(
        v_st.teacher_id,v_st.id,v_effective,v_r.start_time,v_r.end_time,
        null,v_r.id,v_date) then
        raise exception '補課時間衝突：同一學生或老師在新日期已排其他課程';
      end if;
      insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,moved_to,remarks)
      values(v_r.id,v_r.teacher_id,v_date,'reschedule',v_effective,'共享課程改期')
      on conflict(schedule_id,original_date) do update set action='reschedule',
        moved_to=excluded.moved_to,remarks=excluded.remarks;
      v_summary:='將 '||v_date::text||' 課程改至 '||v_effective::text;
    else
      insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,remarks)
      values(v_r.id,v_r.teacher_id,v_date,
        case when v_cancel_source='teacher' then 'teacher_leave' else 'student_leave' end,'共享課程取消')
      on conflict(schedule_id,original_date) do update set
        action=excluded.action,
        moved_to=null,remarks=excluded.remarks;
      v_summary:='取消固定課表單堂 '||v_date::text;
    end if;
    -- A single projected occurrence has no row timestamp of its own.
    -- Touch the parent rule to make future stale occurrence edits conflict.
    update public.recurring_schedules set updated_at=clock_timestamp() where id=v_r.id;
    v_id:=v_r.id;
  else
    raise exception '不支援的操作';
  end if;

  insert into tutor_private.shared_course_events(
    student_id,actor_id,actor_role,action,target_id,summary,
    cancellation_source,cancellation_reason)
  values(v_st.id,v_actor,v_actor_role,p_action,v_id,v_summary,
    case when p_action in ('cancel_lesson','cancel_schedule','cancel_occurrence')
      then v_cancel_source else null end,
    case when p_action in ('cancel_lesson','cancel_schedule','cancel_occurrence')
      then v_cancel_reason else null end);
  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;

-- Changed public RPC retains the same signed-in-only interface.
revoke all on function public.shared_course_action(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.shared_course_action(text,uuid,uuid,jsonb) to authenticated;


-- Return actor role/reason to authorized members, not billing values.
create or replace function public.shared_course_history(p_student_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'action',v.action,'summary',v.summary,'actor_id',v.actor_id,
  'actor_role',v.actor_role,'cancellation_source',v.cancellation_source,
  'cancellation_reason',v.cancellation_reason,'created_at',v.created_at)
  order by v.created_at desc),'[]'::jsonb)
from (select e.action,e.summary,e.actor_id,e.actor_role,e.cancellation_source,
  e.cancellation_reason,e.created_at
  from tutor_private.shared_course_events e
  where e.student_id=p_student_id and auth.uid() is not null
   and exists(select 1 from public.students s where s.id=p_student_id
    and (s.teacher_id=auth.uid()
       or exists(select 1 from public.student_guardians g
         where g.student_id=s.id and g.guardian_id=auth.uid() and g.teacher_id=s.teacher_id)
       or exists(select 1 from public.student_links sl
         where sl.student_id=s.id and sl.user_id=auth.uid() and sl.teacher_id=s.teacher_id)))
 order by e.created_at desc limit 30) v;
$$;
revoke all on function public.shared_course_history(uuid) from public,anon;
grant execute on function public.shared_course_history(uuid) to authenticated;


-- Make teacher's legacy direct table writes obey the same collision rule.
-- The guard only runs if a live lesson's date/time/student/owner/type changes.
create or replace function tutor_private.v34_guard_lesson_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.student_id is null or new.type in ('leave','moved')
    or new.start_time is null or new.end_time is null then
   return new;
 end if;
 if tg_op='UPDATE' then
   if (new.student_id,new.owner_id,new.lesson_date,new.start_time,new.end_time,new.type)
      is not distinct from
      (old.student_id,old.owner_id,old.lesson_date,old.start_time,old.end_time,old.type)
      then return new;
   end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,42034));
 if tutor_private.v34_has_conflict(new.owner_id,new.student_id,new.lesson_date,
      new.start_time,new.end_time,
      case when tg_op='UPDATE' then old.id else null end,
      new.schedule_id,new.scheduled_date) then
   raise exception '課程時間衝突：這位老師或學生在同一時間已有其他課程';
 end if;
 return new;
end;$$;
revoke all on function tutor_private.v34_guard_lesson_write() from public,anon,authenticated;
drop trigger if exists trg_v34_guard_lesson_write on public.lesson_records;
create trigger trg_v34_guard_lesson_write
 before insert or update on public.lesson_records
 for each row execute function tutor_private.v34_guard_lesson_write();

create or replace function tutor_private.v34_guard_rule_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if (new.student_id,new.teacher_id,new.starts_on,new.ends_on,
     new.weekdays,new.every_weeks,new.start_time,new.end_time)
      is not distinct from
      (old.student_id,old.teacher_id,old.starts_on,old.ends_on,
       old.weekdays,old.every_weeks,old.start_time,old.end_time) then
       return new;
   end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.teacher_id::text,42034));
 perform tutor_private.v34_assert_schedule_available(
   new.teacher_id,new.student_id,new.starts_on,new.ends_on,
   new.weekdays,new.every_weeks,new.start_time,new.end_time,
   case when tg_op='UPDATE' then old.id else null end);
 return new;
end;$$;
revoke all on function tutor_private.v34_guard_rule_write() from public,anon,authenticated;
drop trigger if exists trg_v34_guard_rule_write on public.recurring_schedules;
create trigger trg_v34_guard_rule_write
 before insert or update on public.recurring_schedules
 for each row execute function tutor_private.v34_guard_rule_write();

-- A direct teacher edit to a single recurring occurrence advances the rule's
-- revision; that invalidates stale guardian/student dialogs for this series.
create or replace function tutor_private.v34_guard_exception_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 v public.recurring_schedules%rowtype;
 v_teacher uuid;
 v_schedule uuid;
begin
 v_schedule:=case when tg_op='DELETE' then old.schedule_id else new.schedule_id end;
 v_teacher:=case when tg_op='DELETE' then old.teacher_id else new.teacher_id end;
 perform pg_advisory_xact_lock(hashtextextended(v_teacher::text,42034));
 select * into v from public.recurring_schedules where id=v_schedule for update;
 if not found then
   if tg_op='DELETE' then return old; end if;
   return new;
 end if;
 if tg_op<>'DELETE' then
   if not tutor_private.v34_occurs(v.starts_on,v.ends_on,v.cancelled_from,
     v.weekdays,v.every_weeks,new.original_date) then
      raise exception '無效的固定課表日期：此日不是有效的雙週／每週課程';
   end if;
   if new.action='reschedule' and
     tutor_private.v34_has_conflict(v.teacher_id,v.student_id,new.moved_to,
       v.start_time,v.end_time,null,v.id,new.original_date) then
      raise exception '補課時間衝突：新日期已有其他學生或老師的課程';
   end if;
 end if;
 update public.recurring_schedules set updated_at=clock_timestamp() where id=v.id;
 if tg_op='DELETE' then return old; end if;
 return new;
end;$;
revoke all on function tutor_private.v34_guard_exception_write() from public,anon,authenticated;
drop trigger if exists trg_v34_guard_exception_write on public.schedule_exceptions;
create trigger trg_v34_guard_exception_write
 before insert or update or delete on public.schedule_exceptions
 for each row execute function tutor_private.v34_guard_exception_write();
