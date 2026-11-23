-- V5.8 source-side backup / private-restore parity reference.
-- SELECT ONLY: scalar row counts and RPC/RLS metadata. NO users' PII,
-- payment amounts, auth tokens, secret values, lessons or raw rows.
-- Run on Production as read-only evidence; independently rerun against a
-- genuinely isolated restore with external notifications disabled.
-- One matching report is NOT proof of correct restore without real dump + SHA.
with versions as (
 select count(*)::integer n, max(version) latest from supabase_migrations.schema_migrations
), counts as (
 select jsonb_build_object(
  'auth_users',(select count(*) from auth.users),
  'workspaces',(select count(*) from public.workspaces),
  'students',(select count(*) from public.students),
  'guardian_links',(select count(*) from public.student_guardians),
  'payment_batches',(select count(*) from public.payment_batches),
  'payment_corrections',(select count(*) from public.payment_batch_corrections),
  'teams',(select count(*) from public.v5_teams),
  'team_projects',(select count(*) from public.v5_team_projects),
  'team_students',(select count(*) from public.v5_team_students),
  'team_lessons',(select count(*) from public.v5_team_lessons),
  'team_lesson_fees',(select count(*) from tutor_private.v5_team_lesson_fees),
  'team_payment_reports',(select count(*) from tutor_private.v5_team_payment_reports),
  'team_payment_allocations',(select count(*) from tutor_private.v5_team_payment_allocations),
  'team_advance_credits',(select count(*) from tutor_private.v5_team_advance_credits),
  'team_refund_requests',(select count(*) from tutor_private.v56_team_direct_refund_intake),
  'family_bridge_acceptances',(select count(*) from tutor_private.v56_team_family_bridge_acceptances),
  'family_bridge_revocations',(select count(*) from tutor_private.v56_team_family_bridge_revocations),
  'storage_buckets',(select count(*) from storage.buckets),
  'storage_objects',(select count(*) from storage.objects),
  'vault_secrets',(select count(*) from vault.secrets)
 ) as value
), rpc as (
 select md5(p.prosrc) body_hash,p.prosecdef,p.provolatile,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_executable,
  has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_executable
 from pg_proc p
 where p.oid='public.v56_team_parent_finance_overview(uuid,uuid,date)'::regprocedure
), rls as (
 select count(*) filter(where c.relrowsecurity)::integer as enabled,
  count(*) filter(where not c.relrowsecurity)::integer as disabled
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','tutor_private') and c.relkind='r'
)
select jsonb_build_object(
 'purpose','V58_RESTORE_PARITY_REFERENCE_NOT_BACKUP',
 'source_project_ref','vctisuglfoxyuwlvyjee',
 'sample_time_utc',now() at time zone 'UTC',
 'migration_count',versions.n,
 'latest_version',versions.latest,
 'database_bytes',pg_database_size(current_database()),
 'counts',counts.value,
 'parent_rpc_md5',rpc.body_hash,
 'rpc_security_definer',rpc.prosecdef,
 'rpc_stable',rpc.provolatile='s',
 'rpc_anon_executable',rpc.anon_executable,
 'rpc_authenticated_executable',rpc.authenticated_executable,
 'rls_table_count',rls.enabled,'non_rls_table_count',rls.disabled,
 'production_writes',0
)::text as metadata_only_restore_parity_reference
from versions cross join counts cross join rpc cross join rls;
