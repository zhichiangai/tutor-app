-- Prevent deletion of financial history for legacy and date-range payments.
create or replace function tutor_private.prevent_financial_lesson_delete()
returns trigger language plpgsql security definer set search_path='' as $guard$
begin
 if old.status in ('老師已收到','家長已付款')
 or exists(select 1 from public.payment_batch_items i where i.lesson_id=old.id)
 or exists(select 1 from public.family_requests r
   where r.lesson_id=old.id and r.kind='payment' and r.status in ('pending','approved'))
 then
  raise exception 'Reconcile paid lesson before deleting its financial history';
 end if;
 return old;
end $guard$;
drop trigger if exists trg_prevent_financial_lesson_delete on public.lesson_records;
create trigger trg_prevent_financial_lesson_delete
before delete on public.lesson_records
for each row execute function tutor_private.prevent_financial_lesson_delete();