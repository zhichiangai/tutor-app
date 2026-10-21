-- V3.3: teacher, linked guardian, and linked student share scheduling permissions.
-- Browser roles never grant access. All mutations are column-whitelisted and scoped by student.
-- No browser UPDATE/INSERT grants added to financial records or student_links.
create table if not exists tutor_private.shared_course_events (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  actor_id uuid not null,
  action text not null,
  target_id uuid,
  summary text not null,
  created_at timestamptz not null default now()
);
create index if not exists shared_course_events_student_idx
  on tutor_private.shared_course_events(student_id,created_at desc);
revoke all on tutor_private.shared_course_events from public,anon,authenticated;

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
    if (p_payload ? 'expected_updated_at')
       and v_l.updated_at<>(p_payload->>'expected_updated_at')::timestamptz then
      raise exception '課程剛被其他人修改，請重新整理';
    end if;
    if p_action='update_lesson' then
      update public.lesson_records set lesson_date=v_date,subject=v_subject,
        start_time=v_start,end_time=v_end,hours=round(v_hours,2),
        total_amount=round(v_hours*v_l.hourly_rate,2),updated_at=now()
        where id=v_l.id;
      v_summary:='調整單堂課 '||v_date::text||' '||v_subject;
    else
      update public.lesson_records set type='leave',leave_source='student',
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
      insert into public.recurring_schedules(teacher_id,student_id,subject,weekdays,
        every_weeks,starts_on,ends_on,start_time,end_time,hourly_rate)
      values(v_st.teacher_id,v_st.id,v_subject,v_weekdays,v_frequency,
        v_date,v_enddate,v_start,v_end,v_st.hourly_rate) returning id into v_id;
      v_summary:='新增固定課表 '||v_subject||' '||v_date::text;
    else
      select * into v_r from public.recurring_schedules
        where id=p_target_id and student_id=v_st.id and teacher_id=v_st.teacher_id for update;
      if not found then raise exception '找不到固定課表'; end if;
      if (p_payload ? 'expected_updated_at')
        and v_r.updated_at<>(p_payload->>'expected_updated_at')::timestamptz then
        raise exception '固定課表剛被其他人修改，請重新整理';
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
      update public.recurring_schedules
        set cancelled_from=v_effective,updated_at=now()
        where id=v_r.id;
      update public.lesson_records set type='leave',leave_source='student',hours=0,
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
    if (p_payload ? 'expected_updated_at')
      and v_r.updated_at<>(p_payload->>'expected_updated_at')::timestamptz then
      raise exception '固定課表剛被其他人修改，請重新整理';
    end if;
    v_effective:=coalesce(nullif(p_payload->>'from_date','')::date,v_r.starts_on);
    v_effective:=greatest(v_effective,v_r.starts_on);
    if v_r.ends_on is not null and v_effective>v_r.ends_on then
      raise exception '所選日期超出課表範圍'; end if;
    if exists(select 1 from public.lesson_records l
       where l.schedule_id=v_r.id and l.scheduled_date>=v_effective
         and l.type='planned'
         and (l.status<>'未付款'
            or exists(select 1 from public.payment_batch_items b where b.lesson_id=l.id)
            or exists(select 1 from public.family_requests f where f.lesson_id=l.id and f.status='pending')))
      then raise exception '未來課程已進入帳務流程，不能取消'; end if;
    v_effective:=least(v_effective,coalesce(v_r.cancelled_from,v_effective));
    update public.recurring_schedules set cancelled_from=v_effective,updated_at=now()
      where id=v_r.id;
    update public.lesson_records set type='leave',leave_source='student',hours=0,
       total_amount=0,actual_hours=null,actual_start_time=null,actual_end_time=null,updated_at=now()
      where schedule_id=v_r.id and scheduled_date>=v_effective and type='planned';
    v_id:=v_r.id;
    v_summary:='停止固定課表 '||v_effective::text;

  elsif p_action in ('change_occurrence','cancel_occurrence') then
    select * into v_r from public.recurring_schedules
      where id=p_target_id and student_id=v_st.id and teacher_id=v_st.teacher_id for update;
    if not found then raise exception '找不到固定課表'; end if;
    v_date:=(p_payload->>'original_date')::date;
    if v_date is null or v_date<v_r.starts_on
       or (v_r.ends_on is not null and v_date>v_r.ends_on)
       or (v_r.cancelled_from is not null and v_date>=v_r.cancelled_from)
       or extract(isodow from v_date)::integer <> all(v_r.weekdays)
       then raise exception '這天不是有效的固定上課日'; end if;
    if exists(select 1 from public.lesson_records l where l.schedule_id=v_r.id
       and l.scheduled_date=v_date) then
       raise exception '這堂課已有獨立紀錄，請從課程清單修改'; end if;
    if p_action='change_occurrence' then
      v_effective:=(p_payload->>'moved_to')::date;
      if v_effective is null or v_effective=v_date then raise exception '請指定不同的補課日期'; end if;
      insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,moved_to,remarks)
      values(v_r.id,v_r.teacher_id,v_date,'reschedule',v_effective,'共享課程改期')
      on conflict(schedule_id,original_date) do update set action='reschedule',
        moved_to=excluded.moved_to,remarks=excluded.remarks;
      v_summary:='將 '||v_date::text||' 課程改至 '||v_effective::text;
    else
      insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,remarks)
      values(v_r.id,v_r.teacher_id,v_date,'student_leave','共享課程取消')
      on conflict(schedule_id,original_date) do update set action='student_leave',
        moved_to=null,remarks=excluded.remarks;
      v_summary:='取消固定課表單堂 '||v_date::text;
    end if;
    v_id:=v_r.id;
  else
    raise exception '不支援的操作';
  end if;

  insert into tutor_private.shared_course_events(student_id,actor_id,action,target_id,summary)
    values(v_st.id,v_actor,p_action,v_id,v_summary);
  return jsonb_build_object('ok',true,'id',v_id);
end;
$$;
revoke all on function public.shared_course_action(text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.shared_course_action(text,uuid,uuid,jsonb) to authenticated;

create or replace function public.shared_course_history(p_student_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'action',v.action,'summary',v.summary,'actor_id',v.actor_id,'created_at',v.created_at)
  order by v.created_at desc),'[]'::jsonb)
from (select e.action,e.summary,e.actor_id,e.created_at from tutor_private.shared_course_events e
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

-- Student planner needs revision timestamps and single-occurrence exceptions but no money data.
create or replace function public.student_portal_data()
returns jsonb language sql stable security definer set search_path=''
as $$
select jsonb_build_object(
 'students',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'teacher_id',s.teacher_id,'subject',s.subject))
   from public.student_links sl join public.students s on s.id=sl.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'lessons',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'student_id',l.student_id,'lesson_date',l.lesson_date,
   'schedule_id',l.schedule_id,'scheduled_date',l.scheduled_date,
   'subject',l.subject,'start_time',l.start_time,'end_time',l.end_time,
   'type',l.type,'remarks',l.remarks,'focus_rating',l.focus_rating,
   'attitude_rating',l.attitude_rating,'hours',l.hours,'updated_at',l.updated_at))
   from public.lesson_records l join public.student_links sl on sl.student_id=l.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(jsonb_build_object(
   'id',r.id,'student_id',r.student_id,'teacher_id',r.teacher_id,'subject',r.subject,
   'starts_on',r.starts_on,'ends_on',r.ends_on,'cancelled_from',r.cancelled_from,
   'weekdays',r.weekdays,'every_weeks',r.every_weeks,
   'start_time',r.start_time,'end_time',r.end_time,'updated_at',r.updated_at))
   from public.recurring_schedules r join public.student_links sl on sl.student_id=r.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb),
 'exceptions',coalesce((select jsonb_agg(jsonb_build_object(
   'schedule_id',e.schedule_id,'original_date',e.original_date,
   'action',e.action,'moved_to',e.moved_to))
   from public.schedule_exceptions e
   join public.recurring_schedules r on r.id=e.schedule_id
   join public.student_links sl on sl.student_id=r.student_id
   where sl.user_id=auth.uid()), '[]'::jsonb)
);
$$;
revoke all on function public.student_portal_data() from public,anon;
grant execute on function public.student_portal_data() to authenticated;
