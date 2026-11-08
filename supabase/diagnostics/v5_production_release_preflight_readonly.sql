-- 好好上課 V5 正式資料庫唯讀發行前檢查
-- 2026-11-08；供 GitHub PR #58 release review 使用。
-- This script contains only SELECT. No DDL, DML, migration repair, or reset.
-- Never paste the result into a public issue if you add personal fields later.
with core as (
  select c.oid,n.nspname||'.'||c.relname as table_name,c.relrowsecurity as rls_enabled,
         has_table_privilege('anon',c.oid,'SELECT') as anon_select
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and c.relname=any(array[
      'workspaces','workspace_members','profiles','students',
      'student_guardians','lesson_records','payment_batches','payment_batch_items'
    ])
), core_summary as (
  select count(*)::int as core_count,
         count(*) filter(where rls_enabled)::int as rls_count,
         count(*) filter(where anon_select)::int as anon_select_count
  from core
), v5_summary as (
  select count(*)::int as v5_table_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','tutor_private') and c.relkind in ('r','p')
    and c.relname like 'v5\_%' escape '\'
), migration_summary as (
  select count(*)::int as applied_versions,max(version) as latest_version
  from supabase_migrations.schema_migrations
), prerequisite_summary as (
  select
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='students'
      and column_name=any(array['id','workspace_id','created_at']))=3
      as student_columns,
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='workspaces'
      and column_name=any(array['id','owner_id','kind']))=3
      as workspace_columns,
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='workspace_members'
      and column_name=any(array['workspace_id','user_id','role']))=3
      as member_columns,
    exists(select 1 from pg_constraint
      where conrelid='public.workspace_members'::regclass and contype='p'
        and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, user_id)')
      as member_composite_pk
), privacy_summary as (
  select
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','tutor_private') and c.relkind='r'
        and c.relname like 'v5\_%' escape '\'
        and has_table_privilege('anon',c.oid,'SELECT'))::int
      as v5_anon_select_tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and has_function_privilege('authenticated',p.oid,'EXECUTE')
        and not has_function_privilege('anon',p.oid,'EXECUTE'))::int
      as authenticated_only_definer_rpc_count
)
select jsonb_pretty(jsonb_build_object(
  'scope','read_only_production_catalog',
  'applied_migrations', (select applied_versions from migration_summary),
  'latest_migration', (select latest_version from migration_summary),
  'v5_tables', (select v5_table_count from v5_summary),
  'v4_core_tables', (select core_count from core_summary),
  'v4_core_rls', (select rls_count from core_summary),
  'v4_core_anon_select', (select anon_select_count from core_summary),
  'student_required_columns',(select student_columns from prerequisite_summary),
  'workspace_required_columns',(select workspace_columns from prerequisite_summary),
  'membership_required_columns',(select member_columns from prerequisite_summary),
  'membership_composite_primary_key',(select member_composite_pk from prerequisite_summary),
  'v5_anon_select_tables',(select v5_anon_select_tables from privacy_summary),
  'existing_authenticated_only_definer_rpcs',(select authenticated_only_definer_rpc_count from privacy_summary),
  'auth_users_count',(select count(*) from auth.users),
  'v4_workspaces_count',(select count(*) from public.workspaces),
  'v4_students_count',(select count(*) from public.students),
  'v4_lessons_count',(select count(*) from public.lesson_records),
  'v4_payment_batches_count',(select count(*) from public.payment_batches)
)) as release_preflight_metadata;
