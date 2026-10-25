
create or replace function tutor_private.guard_paid_lesson()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_confirmed numeric(12,2);
begin
 if exists (
  select 1 from public.payment_batch_items i
  join public.payment_batches b on b.id=i.batch_id
  where i.lesson_id=old.id and b.status in ('pending','confirmed')
 ) then
  if (new.owner_id,new.student_id,new.lesson_date,new.start_time,new.end_time,new.hours,
      new.hourly_rate,new.total_amount,new.type) is distinct from
     (old.owner_id,old.student_id,old.lesson_date,old.start_time,old.end_time,old.hours,
      old.hourly_rate,old.total_amount,old.type) then
   raise exception 'Cannot alter lesson dates or charges while a payment batch exists';
  end if;
  if new.status is distinct from old.status then
   select coalesce(sum(i.allocated_amount),0) into v_confirmed
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   where i.lesson_id=old.id and b.status='confirmed';
   if new.status<>'老師已收到' or v_confirmed<new.total_amount-0.005 then
     raise exception 'Cannot manually override the payment status of an allocated lesson';
   end if;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists trg_guard_paid_lesson on public.lesson_records;
create trigger trg_guard_paid_lesson before update on public.lesson_records
for each row execute function tutor_private.guard_paid_lesson();
revoke all on function tutor_private.guard_paid_lesson() from public,anon,authenticated;
