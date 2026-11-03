-- READ ONLY. V4 forward-migration dependency survey on an existing database.
-- This validates metadata prerequisites, NOT nine migrations or backup/restore.
WITH required_relations(schema_name,table_name) AS (VALUES
 ('auth','users'),('public','students'),('public','lesson_records'),
 ('public','guardian_invites'),('public','student_guardians'),
 ('public','profiles'),('public','workspaces'),
 ('public','payment_batches'),('public','payment_batch_items'),
 ('public','family_requests'),('tutor_private','legacy_receipt_reversal_audit')
),
required_columns(table_name,column_name) AS (VALUES
 ('students','id'),('students','teacher_id'),('students','workspace_id'),
 ('lesson_records','id'),('lesson_records','owner_id'),('lesson_records','student_id'),
 ('payment_batches','id'),('payment_batches','teacher_id'),('payment_batches','parent_id'),
 ('payment_batches','student_id'),('payment_batches','workspace_id'),
 ('payment_batch_items','batch_id'),('payment_batch_items','lesson_id'),
 ('payment_batch_items','workspace_id'),
 ('student_guardians','invite_id'),('student_guardians','guardian_id'),
 ('student_guardians','teacher_id'),('student_guardians','student_id'),
 ('student_guardians','workspace_id'),
 ('family_requests','teacher_id'),('family_requests','parent_id'),
 ('family_requests','student_id'),('family_requests','workspace_id')
),
required_functions(function_name) AS (VALUES
 ('submit_range_payment'),('review_range_payment'),('guard_paid_lesson')
),
checks AS (
 SELECT
 (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS migration_count,
 (SELECT coalesce(jsonb_agg(schema_name||'.'||table_name),'[]'::jsonb)
    FROM required_relations r WHERE pg_catalog.to_regclass(
      pg_catalog.format('%I.%I',r.schema_name,r.table_name)) IS NULL) AS missing_relations,
 (SELECT coalesce(jsonb_agg(table_name||'.'||column_name),'[]'::jsonb)
    FROM required_columns r WHERE NOT EXISTS(
      SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
        AND c.table_name=r.table_name AND c.column_name=r.column_name)) AS missing_columns,
 (SELECT count(*)::int FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='tutor_private'
   AND p.proname IN (SELECT function_name FROM required_functions)) AS foundation_functions,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=
    pg_catalog.to_regclass('public.student_guardians') AND c.relrowsecurity) AS guardian_rls_enabled,
 (SELECT count(*)::int FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public'
   AND c.relname IN ('v4_connection_requests','payment_batch_corrections',
     'payment_batch_correction_items','v4_account_contacts')) AS v4_tables_present,
 (SELECT count(*)::int FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND cmd='SELECT'
   AND (tablename,policyname) IN (
    ('payment_batches','batch_read_by_teacher_or_parent'),
    ('payment_batch_items','items_read_by_batch_participant'),
    ('family_requests','requests_teacher_or_parent_view'))) AS target_payment_policies,
 (SELECT count(*)::int FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND cmd='SELECT' AND
    (tablename,policyname) IN (
     ('payment_batches','batch_read_by_teacher_or_parent'),
     ('payment_batch_items','items_read_by_batch_participant'),
     ('family_requests','requests_teacher_or_parent_view'))
    AND qual ILIKE '%student_guardians%' AND qual ILIKE '%workspace_id%') AS active_link_guarded_payment_policies
)
SELECT
 migration_count,missing_relations,missing_columns,foundation_functions,
 guardian_rls_enabled,v4_tables_present,target_payment_policies,active_link_guarded_payment_policies,
 CASE WHEN jsonb_array_length(missing_relations)>0 OR jsonb_array_length(missing_columns)>0
     OR foundation_functions<>3 OR NOT guardian_rls_enabled
      THEN 'BASELINE_MISSING_DEPENDENCIES'
   WHEN v4_tables_present BETWEEN 1 AND 3 THEN 'PARTIAL_V4_SCHEMA_STOP'
   WHEN v4_tables_present=0 THEN 'V4_NOT_INSTALLED'
   ELSE 'V4_TABLES_PRESENT_REVIEW' END AS schema_stage,
 'NO_GO_UNTIL_BACKUP_RESTORE_AND_FORWARD_TEST'::text AS release_gate
FROM checks;
