-- V3.1: Cancellable future recurrences without deleting financial history.
-- Existing lessons/payment batches stay; cancelled future planned lessons are kept as non-billable traces.
alter table public.recurring_schedules
 add column if not exists cancelled_from date;

create or replace function public.cancel_recurring_schedule(p_schedule_id uuid, p_from date)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  r public.recurring_schedules%rowtype;
  effective date;
begin
  if (select auth.uid()) is null or p_from is null then
    raise exception 'Login and cancellation date are required';
  end if;
  select * into r from public.recurring_schedules
   where id=p_schedule_id and teacher_id=(select auth.uid())
   for update;
  if not found then raise exception 'Schedule not found or access denied'; end if;
  effective := greatest(p_from,r.starts_on);
  if r.ends_on is not null and effective>r.ends_on then
    raise exception 'Cancellation starts after this schedule already ends';
  end if;
  effective := least(effective,coalesce(r.cancelled_from,effective));

  -- Refuse an ambiguous operation if a future scheduled lesson is in a payment/request flow.
  if exists (
    select 1 from public.lesson_records l
    where l.schedule_id=r.id and l.scheduled_date>=effective and l.type='planned'
      and (
        l.status in ('老師已收到','家長已付款')
        or exists(select 1 from public.payment_batch_items pi where pi.lesson_id=l.id)
        or exists(select 1 from public.family_requests fr where fr.lesson_id=l.id
          and fr.status in ('pending','approved') and fr.kind='payment')
      )
  ) then
    raise exception 'A future scheduled lesson has payment records; resolve its accounting first';
  end if;

  update public.recurring_schedules
     set cancelled_from=effective
   where id=r.id and teacher_id=(select auth.uid());

  -- Preserve completed lessons and past payments. Only non-financial planned rows are cancelled.
  update public.lesson_records l
     set type='leave', leave_source='teacher',
         hours=0, total_amount=0, actual_hours=null,
         actual_start_time=null, actual_end_time=null,
         remarks=case when coalesce(l.remarks,'')='' then '已取消後續排課'
                      else l.remarks end,
         updated_at=now()
   where l.schedule_id=r.id and l.scheduled_date>=effective
     and l.owner_id=(select auth.uid()) and l.type='planned';
end;
$$;
revoke all on function public.cancel_recurring_schedule(uuid,date) from public,anon;
grant execute on function public.cancel_recurring_schedule(uuid,date) to authenticated;

-- A teacher can change only the email of an unaccepted invitation.
-- Teacher and student identity are never editable from the browser.
revoke update on public.guardian_invites from public,anon,authenticated;
grant update(email) on public.guardian_invites to authenticated;
drop policy if exists invites_teacher_update_pending on public.guardian_invites;
create policy invites_teacher_update_pending on public.guardian_invites
 for update to authenticated
 using(
   teacher_id=(select auth.uid())
   and not exists(select 1 from public.student_guardians g where g.invite_id=guardian_invites.id)
 )
 with check(
   teacher_id=(select auth.uid())
   and not exists(select 1 from public.student_guardians g where g.invite_id=guardian_invites.id)
 );
