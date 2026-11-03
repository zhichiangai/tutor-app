-- V4 P0: metadata-only compatibility preflight for standalone guardian payment SELECT hotfix.
-- Production-safe READ ONLY diagnostic. Does NOT apply the hotfix or approve release.
-- Output contains only aggregate schema metadata: no students, money, identifiers or tokens.
-- Compare to supabase/hotfixes/20261028_parent_payment_active_link_select.sql.
-- A schema precheck PASS is NOT evidence of correct historical JWT/REST behavior or backup/restore.
WITH required(table_name,column_name) AS (
 VALUES
 ('payment_batches','id'),
 ('payment_batches','teacher_id'),
 ('payment_batches','parent_id'),
 ('payment_batches','student_id'),
 ('payment_batches','workspace_id'),
 ('payment_batch_items','batch_id'),
 ('payment_batch_items','workspace_id'),
 ('family_requests','teacher_id'),
 ('family_requests','parent_id'),
 ('family_requests','student_id'),
 ('family_requests','workspace_id'),
 ('student_guardians','guardian_id'),
 ('student_guardians','teacher_id'),
 ('student_guardians','student_id'),
 ('student_guardians','workspace_id')
), existing_policies AS (
 SELECT tablename,policyname,cmd,permissive,roles,qual
 FROM pg_policies
 WHERE schemaname='public' AND tablename IN
  ('payment_batches','payment_batch_items','family_requests')
   AND cmd IN ('SELECT','ALL')
), targets AS (
 SELECT * FROM existing_policies
 WHERE cmd='SELECT'
   AND (tablename,policyname) IN (
    ('payment_batches','batch_read_by_teacher_or_parent'),
    ('payment_batch_items','items_read_by_batch_participant'),
    ('family_requests','requests_teacher_or_parent_view'))
), metrics AS (
 SELECT
  (SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS production_migration_count,
  (SELECT count(*)::int FROM required) AS required_columns,
  (SELECT count(*)::int FROM required r WHERE EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=r.table_name
      AND c.column_name=r.column_name)) AS compatible_columns,
  (SELECT count(*)::int FROM targets) AS target_select_policies,
  (SELECT count(*)::int FROM targets
   WHERE 'authenticated'=ANY(roles) AND permissive='PERMISSIVE')
    AS authenticated_permissive_targets,
  (SELECT count(*)::int FROM targets
   WHERE qual ILIKE '%student_guardians%' AND qual ILIKE '%workspace_id%')
    AS already_active_link_guarded_targets,
  (SELECT count(*)::int FROM existing_policies p WHERE NOT EXISTS (
    SELECT 1 FROM targets t
    WHERE t.tablename=p.tablename AND t.policyname=p.policyname))
    AS unexpected_select_or_all_policies,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN
    ('payment_batches','payment_batch_items','family_requests','student_guardians')
     AND c.relrowsecurity) AS rls_enabled_including_guardian_links,
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname='public' AND tablename='student_guardians'
     AND cmd='SELECT' AND 'authenticated'=ANY(roles))
     AS guardian_link_authenticated_select_policies,
  has_table_privilege('authenticated','public.student_guardians','SELECT')
     AS authenticated_can_read_guardian_links,
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname='public' AND tablename='student_guardians'
    AND cmd IN ('ALL','SELECT')
    AND (qual ILIKE '%payment_batches%' OR qual ILIKE '%family_requests%'))
     AS potential_guardian_policy_recursion,
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='payment_batch_corrections')
    AS payment_correction_table_exists
)
SELECT *,
 CASE
  WHEN production_migration_count=29
    AND compatible_columns=15 AND required_columns=15
    AND target_select_policies=3
    AND authenticated_permissive_targets=3
    AND unexpected_select_or_all_policies=0
    AND rls_enabled_including_guardian_links=4
    AND guardian_link_authenticated_select_policies>=1
    AND authenticated_can_read_guardian_links
    AND potential_guardian_policy_recursion=0
   THEN 'SCHEMA_PRECHECK_PASS_NOT_RELEASE_APPROVAL'
   ELSE 'SCHEMA_PRECHECK_BLOCKED'
 END AS hotfix_schema_precheck,
 'NO_GO_BACKUP_RESTORE_ROLE_TEST_AND_EXPLICIT_APPROVAL_REQUIRED'::text
  AS production_release_gate
FROM metrics;
