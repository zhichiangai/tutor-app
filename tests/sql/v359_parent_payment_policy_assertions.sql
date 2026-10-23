-- Execute against a disposable local Supabase after all migrations replay.
do $test$
declare n integer;
begin
  select count(*) into n from pg_policies
  where schemaname='public' and
    (tablename,policyname) in (
      ('payment_batches','batch_read_by_teacher_or_parent'),
      ('payment_batch_items','items_read_by_batch_participant'),
      ('family_requests','requests_teacher_or_parent_view'))
    and qual like '%student_guardians%'
    and qual like '%workspace_id%';
  if n<>3 then raise exception 'Expected three active-link policies, got %',n; end if;

  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
  where s.nspname='public' and c.relname in
    ('payment_batches','payment_batch_items','family_requests') and c.relrowsecurity;
  if n<>3 then raise exception 'Payment/request tables must all have RLS'; end if;

  if has_function_privilege('anon','public.submit_range_payment(uuid,uuid,date,date,date,numeric,text)','EXECUTE')
    or has_function_privilege('anon','public.review_range_payment(uuid,boolean,date)','EXECUTE')
    or has_function_privilege('anon','public.review_family_request(uuid,boolean)','EXECUTE')
  then raise exception 'Anonymous role may execute a financial RPC'; end if;
  raise notice 'PASS: 3 linked policies, 3 RLS tables, 3 anonymous RPC denials';
end $test$;
