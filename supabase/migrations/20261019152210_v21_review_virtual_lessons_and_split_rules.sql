
create or replace function public.review_family_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security invoker set search_path=''
as $$
declare r public.family_requests%rowtype;
begin
  select * into r from public.family_requests f
  where f.id=p_request_id and f.teacher_id=(select auth.uid()) and f.status='pending'
  for update;
  if not found then raise exception 'Request not found or no permission'; end if;
  if p_approve then
    if r.lesson_id is not null then
      if r.kind='leave' then
        update public.lesson_records set type='leave', leave_source='student', updated_at=now()
        where id=r.lesson_id and owner_id=(select auth.uid()) and student_id=r.student_id;
      else
        update public.lesson_records set status='家長已付款',payment_date=current_date,updated_at=now()
        where id=r.lesson_id and owner_id=(select auth.uid()) and student_id=r.student_id and type='lesson';
      end if;
      if not found then raise exception 'Related lesson not found or invalid status'; end if;
    elsif r.schedule_id is not null and r.scheduled_date is not null and r.kind='leave' then
      if not exists (select 1 from public.recurring_schedules s where s.id=r.schedule_id
        and s.teacher_id=(select auth.uid()) and s.student_id=r.student_id
        and r.scheduled_date >= s.starts_on and (s.ends_on is null or r.scheduled_date<=s.ends_on)
        and extract(isodow from r.scheduled_date)::smallint=any(s.weekdays)
        and ((r.scheduled_date - (s.starts_on - (extract(isodow from s.starts_on)::int - 1))) / 7)::int % s.every_weeks=0
      ) then raise exception 'Invalid recurring occurrence'; end if;
      insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,remarks)
      values(r.schedule_id,r.teacher_id,r.scheduled_date,'student_leave',r.note)
      on conflict(schedule_id,original_date) do update set action='student_leave',moved_to=null,remarks=excluded.remarks;
    else raise exception 'Invalid request target'; end if;
  end if;
  update public.family_requests set status=(case when p_approve then 'approved' else 'declined' end),reviewed_at=now()
  where id=r.id;
end; $$;
revoke all on function public.review_family_request(uuid,boolean) from public,anon;
grant execute on function public.review_family_request(uuid,boolean) to authenticated;

create or replace function public.split_recurring_schedule(
 p_id uuid,p_effective date,p_student_id uuid,p_subject text,p_weekdays smallint[],p_every_weeks smallint,
 p_end_date date,p_start_time text,p_end_time text,p_hourly_rate numeric
) returns uuid language plpgsql security invoker set search_path=''
as $$
declare old_row public.recurring_schedules%rowtype; new_id uuid;
begin
 select * into old_row from public.recurring_schedules s where s.id=p_id and s.teacher_id=(select auth.uid()) for update;
 if not found then raise exception 'Schedule missing or permission denied'; end if;
 if p_effective<=old_row.starts_on then raise exception 'Effective date must follow original schedule start'; end if;
 if old_row.ends_on is not null and p_effective>old_row.ends_on then raise exception 'Effective date beyond schedule end'; end if;
 update public.recurring_schedules set ends_on=p_effective-1,updated_at=now() where id=p_id;
 insert into public.recurring_schedules(teacher_id,student_id,subject,weekdays,every_weeks,starts_on,ends_on,start_time,end_time,hourly_rate)
 values((select auth.uid()),p_student_id,p_subject,p_weekdays,p_every_weeks,p_effective,p_end_date,p_start_time,p_end_time,p_hourly_rate) returning id into new_id;
 return new_id;
end; $$;
revoke all on function public.split_recurring_schedule(uuid,date,uuid,text,smallint[],smallint,date,text,text,numeric) from public,anon;
grant execute on function public.split_recurring_schedule(uuid,date,uuid,text,smallint[],smallint,date,text,text,numeric) to authenticated;
