-- READ-ONLY V4 Production release diagnostic; metadata only, no student or financial rows.
-- This is not release approval and does not execute any migration, hotfix or backup.
-- Compare with docs/qa/V4_PRODUCTION_MIGRATION_BASELINE_20261029.json.
-- Never run db push / migration repair to reconcile divergent migration identifiers.
WITH expected(version) AS (
 VALUES
  ('20261019090405'),
  ('20261019091930'),
  ('20261019093329'),
  ('20261019093428'),
  ('20261019152058'),
  ('20261019152210'),
  ('20261019162650'),
  ('20261019163424'),
  ('20261019163504'),
  ('20261019183328'),
  ('20261019183511'),
  ('20261019183632'),
  ('20261019183708'),
  ('20261019183944'),
  ('20261019184235'),
  ('20261019193426'),
  ('20261019194414'),
  ('20261019201357'),
  ('20261020101239'),
  ('20261020104006'),
  ('20261020135424'),
  ('20261021033215'),
  ('20261021033435'),
  ('20261021065558'),
  ('20261021074320'),
  ('20261021103622'),
  ('20261021105622'),
  ('20261021185157'),
  ('20261022110047')
),
observed AS (
 SELECT version::text AS version FROM supabase_migrations.schema_migrations
),
rls AS (
 SELECT tablename,policyname,cmd,qual FROM pg_policies
 WHERE schemaname='public'
   AND (tablename,policyname) IN (
    ('payment_batches','batch_read_by_teacher_or_parent'),
    ('payment_batch_items','items_read_by_batch_participant'),
    ('family_requests','requests_teacher_or_parent_view')
   ) AND cmd='SELECT'
)
SELECT
 (SELECT count(*)::int FROM observed) AS production_migration_count,
 (SELECT count(*)::int FROM expected e WHERE NOT EXISTS
   (SELECT 1 FROM observed o WHERE o.version=e.version)) AS missing_expected_versions,
 (SELECT count(*)::int FROM observed o WHERE NOT EXISTS
   (SELECT 1 FROM expected e WHERE e.version=o.version)) AS unexpected_versions,
 (SELECT count(*)::int FROM rls) AS target_select_policies,
 (SELECT count(*)::int FROM rls WHERE qual LIKE '%student_guardians%'
   AND qual LIKE '%workspace_id%') AS active_guardian_link_policies,
 (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
   ('payment_batches','payment_batch_items','family_requests')
   AND c.relrowsecurity) AS rls_enabled_target_tables,
 EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='students' AND column_name='is_qa') AS students_is_qa,
 EXISTS (SELECT 1 FROM information_schema.tables
   WHERE table_schema='public' AND table_name='payment_batch_corrections') AS correction_table_exists,
 'NO_GO_RESTORE_AND_APPROVAL_REQUIRED'::text AS release_gate;
