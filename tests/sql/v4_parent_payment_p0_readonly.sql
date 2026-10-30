-- PR #43 P0: READ-ONLY, localhost-only diagnostic.
-- Never run against Production. This reads schema/mocked data aggregates only.
-- Do not expose Auth tokens, student names, notes or payment IDs in reports.
-- Safety: no INSERT/UPDATE/DELETE/DDL; it cannot repair the inconsistency.
with
  lesson_totals as (
    select l.id,
           l.status,
           l.total_amount,
           exists(
             select 1 from public.v4_lesson_qa_marks m
              where m.lesson_id=l.id and m.is_qa and m.classification='simulated_lesson'
           ) as whole_qa,
           exists(
             select 1 from public.v4_lesson_qa_marks m
              where m.lesson_id=l.id and m.is_qa and m.classification='simulated_legacy_receipt'
           ) as legacy_qa,
           coalesce(sum(i.allocated_amount) filter (
             where b.status in ('pending','confirmed')),0) as all_reserved,
           coalesce(sum(i.allocated_amount) filter (
             where b.status in ('pending','confirmed')
               and coalesce(m.is_qa,false)=false),0) as nonqa_reserved,
           count(i.batch_id) filter (
             where b.status in ('pending','confirmed')
               and coalesce(m.is_qa,false)=true) as qa_payment_lines
    from public.lesson_records l
    left join public.payment_batch_items i on i.lesson_id=l.id
    left join public.payment_batches b on b.id=i.batch_id
    left join public.v4_payment_batch_qa_marks m on m.batch_id=b.id
    where l.type='lesson'
    group by l.id,l.status,l.total_amount
  ),
  discrepancy as (
    select *,
      greatest(total_amount-nonqa_reserved,0) as available_without_qa_reservations,
      greatest(total_amount-all_reserved,0) as available_with_qa_reservations
    from lesson_totals
    where not whole_qa and (legacy_qa or qa_payment_lines>0)
  )
select count(*) as qa_affected_lessons,
       count(*) filter(where status in ('老師已收到','家長已付款'))
           as lessons_excluded_by_original_status_gate,
       count(*) filter(where available_without_qa_reservations>available_with_qa_reservations)
           as lessons_with_qa_reservation_mismatch,
       coalesce(sum(available_without_qa_reservations - available_with_qa_reservations),0)::numeric(12,2)
           as qa_reservation_difference,
       count(*) filter(where legacy_qa and status='老師已收到')
           as simulated_legacy_receipts_excluded_by_original_status_gate
from discrepancy;

-- Read only the FUNCTION DEFINITION FLAGS; no private transaction rows.
select
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='tutor_private' and p.proname='submit_range_payment'
      and pg_get_functiondef(p.oid) like '%v4_payment_batch_qa_marks%'
  ) as submit_rpc_understands_qa_batch_marks,
  exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='tutor_private' and p.proname='submit_range_payment'
      and pg_get_functiondef(p.oid) like '%v4_lesson_qa_marks%'
  ) as submit_rpc_understands_qa_lesson_marks,
  current_setting('TimeZone') as database_timezone,
  (now() at time zone 'Asia/Taipei')::date as taipei_business_date;
