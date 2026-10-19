-- V2.5 compatibility migration. Idempotent because V2.5 fields/functions were originally added via live SQL.
-- Run after V2.3 migrations when recreating a fresh database; do not touch existing class/payment rows.
alter table public.lesson_records add column if not exists actual_start_time text;
alter table public.lesson_records add column if not exists actual_end_time text;
alter table public.lesson_records add column if not exists actual_hours numeric(8,2);
alter table public.family_requests add column if not exists requested_actual_start_time text;
alter table public.family_requests add column if not exists requested_actual_end_time text;
alter table public.family_requests add column if not exists requested_actual_hours numeric(8,2);
alter table public.family_requests drop constraint if exists family_requests_kind_check;
alter table public.family_requests add constraint family_requests_kind_check
 check (kind in ('leave','payment','time_correction'));
do $migration$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.lesson_records'::regclass and conname='actual_hours_range') then
  alter table public.lesson_records add constraint actual_hours_range check(actual_hours is null or (actual_hours>0 and actual_hours<=16));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.lesson_records'::regclass and conname='actual_time_format') then
  alter table public.lesson_records add constraint actual_time_format check(
   (actual_start_time is null or actual_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and
   (actual_end_time is null or actual_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.family_requests'::regclass and conname='requested_hours_range') then
  alter table public.family_requests add constraint requested_hours_range
   check(requested_actual_hours is null or (requested_actual_hours>0 and requested_actual_hours<=16));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.family_requests'::regclass and conname='correction_payload_required') then
  alter table public.family_requests add constraint correction_payload_required check(
   kind<>'time_correction' or
   (lesson_id is not null and requested_actual_start_time is not null and requested_actual_end_time is not null and requested_actual_hours is not null));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.family_requests'::regclass and conname='correction_time_format') then
  alter table public.family_requests add constraint correction_time_format check(
   (requested_actual_start_time is null or requested_actual_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') and
   (requested_actual_end_time is null or requested_actual_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
 end if;
end $migration$;
CREATE OR REPLACE FUNCTION public.review_family_request(p_request_id uuid, p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.family_requests%rowtype; l public.lesson_records%rowtype;
begin
 select * into r from public.family_requests f
 where f.id=p_request_id and f.teacher_id=(select auth.uid()) and f.status='pending' for update;
 if not found then raise exception 'Request not found or permission denied'; end if;
 if p_approve then
  if r.lesson_id is not null then
   select * into l from public.lesson_records t
    where t.id=r.lesson_id and t.owner_id=r.teacher_id and t.student_id=r.student_id for update;
   if not found then raise exception 'Lesson no longer exists'; end if;
   if r.kind in ('leave','time_correction') then
    if l.status in ('老師已收到','家長已付款') or
     exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
       where i.lesson_id=l.id and b.status in ('pending','confirmed')) or
     exists(select 1 from public.family_requests q where q.lesson_id=l.id and q.kind='payment' and q.status in ('pending','approved'))
    then raise exception 'Payment must be resolved before changing the lesson'; end if;
   end if;
   if r.kind='leave' then
    update public.lesson_records set type='leave',leave_source='student',actual_hours=null,
      actual_start_time=null,actual_end_time=null,updated_at=now() where id=l.id;
   elsif r.kind='time_correction' then
    if l.type<>'lesson' or r.requested_actual_end_time<=r.requested_actual_start_time then raise exception 'Invalid time correction'; end if;
    update public.lesson_records set actual_start_time=r.requested_actual_start_time,actual_end_time=r.requested_actual_end_time,
      actual_hours=r.requested_actual_hours,hours=r.requested_actual_hours,
      total_amount=round(r.requested_actual_hours*l.hourly_rate,2),updated_at=now()
     where id=l.id;
   elsif r.kind='payment' then
    if l.type<>'lesson' then raise exception 'Not a completed lesson'; end if;
    update public.lesson_records set status='家長已付款',payment_date=(now() at time zone 'Asia/Taipei')::date,updated_at=now() where id=l.id;
   else raise exception 'Invalid request kind'; end if;
  elsif r.kind='leave' and r.schedule_id is not null and r.scheduled_date is not null then
   if not exists(select 1 from public.recurring_schedules s where s.id=r.schedule_id
    and s.teacher_id=r.teacher_id and s.student_id=r.student_id
    and r.scheduled_date>=s.starts_on and (s.ends_on is null or r.scheduled_date<=s.ends_on)
    and extract(isodow from r.scheduled_date)::smallint=any(s.weekdays)
    and ((r.scheduled_date-(s.starts_on-(extract(isodow from s.starts_on)::int-1)))/7)::int%s.every_weeks=0)
   then raise exception 'Invalid recurring lesson'; end if;
   insert into public.schedule_exceptions(schedule_id,teacher_id,original_date,action,remarks)
     values(r.schedule_id,r.teacher_id,r.scheduled_date,'student_leave',r.note)
     on conflict(schedule_id,original_date) do update set action='student_leave',moved_to=null,remarks=excluded.remarks;
  else raise exception 'Invalid request target'; end if;
 end if;
 update public.family_requests set status=case when p_approve then 'approved' else 'declined' end,
  reviewed_at=now() where id=r.id;
end; $function$
;
CREATE OR REPLACE FUNCTION tutor_private.guard_paid_lesson()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_confirmed numeric(12,2);
begin
 if (new.owner_id,new.student_id,new.lesson_date,new.start_time,new.end_time,new.hours,
      new.actual_start_time,new.actual_end_time,new.actual_hours,new.hourly_rate,new.total_amount,new.type)
 is distinct from
    (old.owner_id,old.student_id,old.lesson_date,old.start_time,old.end_time,old.hours,
      old.actual_start_time,old.actual_end_time,old.actual_hours,old.hourly_rate,old.total_amount,old.type) then
  if old.status in ('老師已收到','家長已付款')
   or exists(select 1 from public.family_requests r where r.lesson_id=old.id
     and r.kind='payment' and r.status in ('pending','approved'))
   or exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
     where i.lesson_id=old.id and b.status in ('pending','confirmed')) then
    raise exception 'Reconcile or reverse payment before altering lesson dates or billable hours';
  end if;
 end if;
 if exists(select 1 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
  where i.lesson_id=old.id and b.status in ('pending','confirmed'))
 and new.status is distinct from old.status then
  select coalesce(sum(i.allocated_amount),0) into v_confirmed
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=old.id and b.status='confirmed';
  if new.status<>'老師已收到' or v_confirmed<new.total_amount-0.005 then
   raise exception 'Cannot manually override the payment status of an allocated lesson';
  end if;
 end if;
 return new;
end; $function$
;
drop trigger if exists trg_guard_paid_lesson on public.lesson_records;
create trigger trg_guard_paid_lesson before update on public.lesson_records for each row execute function tutor_private.guard_paid_lesson();
revoke all on function public.review_family_request(uuid,boolean) from public,anon;
grant execute on function public.review_family_request(uuid,boolean) to authenticated;
