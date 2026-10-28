-- P0 operator-reviewed candidate ONLY: active guardian relationship required for historical financial SELECT.
-- Do NOT apply without explicit authorization, fresh verified backup and rollback plan.
-- Standalone security hotfix, deliberately OUTSIDE supabase/migrations: no version fabricated.
-- Re-applying 20261023163138_v359_parent_payment_link_rls.sql later produces identical policies.
-- No payment rows, balances, family connections or migration history are changed here.
-- Stop if schema/RLS differs from expected; never use migration repair/db push for this hotfix.

begin;

do $preflight$
declare n integer;
begin
  select count(*) into n from pg_policies
  where schemaname='public' and cmd='SELECT' and
    (tablename,policyname) in (
      ('payment_batches','batch_read_by_teacher_or_parent'),
      ('payment_batch_items','items_read_by_batch_participant'),
      ('family_requests','requests_teacher_or_parent_view'));
  if n<>3 then raise exception 'Hotfix aborted: expected three SELECT policies, got %',n; end if;

  if exists (
    select 1 from pg_policies where schemaname='public'
      and tablename in ('payment_batches','payment_batch_items','family_requests')
      and cmd in ('ALL','SELECT')
      and policyname not in ('batch_read_by_teacher_or_parent','items_read_by_batch_participant','requests_teacher_or_parent_view')
  ) then raise exception 'Hotfix aborted: unexpected additional SELECT/ALL policy'; end if;

  select count(*) into n from pg_class c join pg_namespace s on s.oid=c.relnamespace
  where s.nspname='public' and c.relname in ('payment_batches','payment_batch_items','family_requests')
    and c.relrowsecurity;
  if n<>3 then raise exception 'Hotfix aborted: RLS must already be enabled on all three tables'; end if;

  select count(*) into n from information_schema.columns
  where table_schema='public' and
    ((table_name='payment_batches' and column_name in ('teacher_id','parent_id','student_id','workspace_id','id')) or
     (table_name='payment_batch_items' and column_name in ('batch_id','workspace_id')) or
     (table_name='family_requests' and column_name in ('teacher_id','parent_id','student_id','workspace_id')) or
     (table_name='student_guardians' and column_name in ('guardian_id','teacher_id','student_id','workspace_id')));
  if n<>15 then raise exception 'Hotfix aborted: expected 15 identity/link columns, got %',n; end if;
end;
$preflight$;

drop policy if exists batch_read_by_teacher_or_parent on public.payment_batches;
create policy batch_read_by_teacher_or_parent
on public.payment_batches for select to authenticated
using (
 teacher_id=(select auth.uid())
 or (
   parent_id=(select auth.uid())
   and exists (
     select 1 from public.student_guardians g
     where g.guardian_id=(select auth.uid())
       and g.teacher_id=payment_batches.teacher_id
       and g.student_id=payment_batches.student_id
       and g.workspace_id=payment_batches.workspace_id
   )
 )
);

drop policy if exists items_read_by_batch_participant on public.payment_batch_items;
create policy items_read_by_batch_participant
on public.payment_batch_items for select to authenticated
using (
 exists (
   select 1 from public.payment_batches b
   where b.id=payment_batch_items.batch_id
     and b.workspace_id=payment_batch_items.workspace_id
     and (
       b.teacher_id=(select auth.uid())
       or (
         b.parent_id=(select auth.uid())
         and exists (
           select 1 from public.student_guardians g
           where g.guardian_id=(select auth.uid())
             and g.teacher_id=b.teacher_id
             and g.student_id=b.student_id
             and g.workspace_id=b.workspace_id
         )
       )
     )
 )
);

drop policy if exists requests_teacher_or_parent_view on public.family_requests;
create policy requests_teacher_or_parent_view
on public.family_requests for select to authenticated
using (
 teacher_id=(select auth.uid())
 or (
   parent_id=(select auth.uid())
   and exists (
     select 1 from public.student_guardians g
     where g.guardian_id=(select auth.uid())
       and g.teacher_id=family_requests.teacher_id
       and g.student_id=family_requests.student_id
       and g.workspace_id=family_requests.workspace_id
   )
 )
);

do $postflight$
declare n integer;
begin
  select count(*) into n from pg_policies where schemaname='public'
    and (tablename,policyname) in (
      ('payment_batches','batch_read_by_teacher_or_parent'),
      ('payment_batch_items','items_read_by_batch_participant'),
      ('family_requests','requests_teacher_or_parent_view'))
    and cmd='SELECT' and qual like '%student_guardians%' and qual like '%workspace_id%';
  if n<>3 then raise exception 'Hotfix aborted: active-link policy postcondition failed'; end if;
end;
$postflight$;

commit;
