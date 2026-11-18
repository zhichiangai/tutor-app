-- V4 -> V5 Phase 0: READ-ONLY Production preflight.
-- This is a diagnostic snapshot, not an RLS authorization test.
-- No personal records, tokens, secrets, identifiers or write operations are selected.
-- Run only with an explicitly authorized read-only database session.
with
  finance_policies as (
    select tablename,policyname,cmd,qual
    from pg_catalog.pg_policies
    where schemaname='public'
      and (
        (tablename='payment_batches' and policyname='batch_read_by_teacher_or_parent')
        or (tablename='payment_batch_items' and policyname='items_read_by_batch_participant')
        or (tablename='family_requests' and policyname='requests_teacher_or_parent_view')
      )
  ),
  legacy_counts as (
    select
      (select count(*) from supabase_migrations.schema_migrations) as migrations,
      (select count(*) from finance_policies
         where cmd='SELECT' and qual like '%student_guardians%'
           and qual like '%workspace_id%') as active_link_policies,
      (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relname in
           ('payment_batches','payment_batch_items','family_requests')
           and c.relrowsecurity) as enabled_finance_rls,
      (select count(*) from information_schema.tables
         where table_schema='public' and table_name in
           ('payment_batch_corrections','payment_batch_correction_items')) as v4_correction_tables,
      (select count(*) from information_schema.columns
         where table_schema='public' and table_name='students' and column_name='is_qa') as qa_student_columns,
      (select count(*) from information_schema.tables
         where table_schema='public' and table_name in
           ('workspaces','workspace_members','students','lesson_records',
            'payment_batches','payment_batch_items')) as v4_core_tables
  )
select
  migrations,
  active_link_policies,
  enabled_finance_rls,
  v4_correction_tables,
  qa_student_columns,
  v4_core_tables,
  case when active_link_policies=3 and enabled_finance_rls=3
       then 'POLICY_TEXT_PRESENT_ONLY_JWT_RETEST_REQUIRED'
       else 'P0_PAYMENT_LINK_RLS_NOT_READY' end as finance_read_gate,
  case when v4_correction_tables=2 and qa_student_columns=1
       then 'SCHEMA_PRESENT_STILL_REQUIRES_E2E'
       else 'V4_SCHEMA_INCOMPLETE' end as v4_schema_gate
from legacy_counts;
