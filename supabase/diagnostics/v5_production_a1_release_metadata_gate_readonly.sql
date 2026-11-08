-- A1 V5 production release metadata preflight (SELECT only).
-- Do not return personal records, raw migration SQL or secret values.
-- Passing this check does NOT prove that 9 V5 SQL files can be applied to the real 43-history schema.
WITH h AS (
 SELECT count(*)::int AS n, max(version) AS latest,
 count(*) FILTER (WHERE statements IS NULL OR cardinality(statements)=0)::int AS missing_sql,
 count(*) FILTER (WHERE rollback IS NOT NULL AND cardinality(rollback)>0)::int AS has_rollback
 FROM supabase_migrations.schema_migrations
), v5(version) AS (
 VALUES ('20261104131300'),('20261105171000'),('20261105181500'),
 ('20261105192000'),('20261105201500'),('20261106031000'),
 ('20261106034000'),('20261106043000'),('20261106050000')
), v4 AS (
 SELECT count(*)::int AS n,
 count(*) FILTER (WHERE c.relrowsecurity)::int AS rls,
 count(*) FILTER (WHERE has_table_privilege('anon',c.oid,'SELECT'))::int AS anon_select
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND c.relname=ANY(ARRAY['workspaces','workspace_members','profiles','students',
 'student_guardians','lesson_records','payment_batches','payment_batch_items'])
), req(tab,col) AS (
 VALUES ('workspaces','id'),('workspaces','owner_id'),('workspaces','kind'),
 ('students','id'),('students','workspace_id'),('students','created_at'),
 ('workspace_members','workspace_id'),('workspace_members','user_id'),('workspace_members','role')
), missing AS (
 SELECT coalesce(jsonb_agg('public.'||req.tab||'.'||req.col),'[]'::jsonb) AS cols
 FROM req LEFT JOIN information_schema.columns c
 ON c.table_schema='public' AND c.table_name=req.tab AND c.column_name=req.col
 WHERE c.column_name IS NULL
), conflicts AS (
 SELECT
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','tutor_private') AND c.relkind IN ('r','p')
 AND left(c.relname,3)='v5_')::int AS tables,
 (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','tutor_private') AND left(p.proname,3)='v5_')::int AS functions,
 (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','tutor_private') AND NOT t.tgisinternal
 AND (left(t.tgname,3)='v5_' OR left(t.tgname,6)='zz_v5_'))::int AS triggers,
 (SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','tutor_private')
 AND left(policyname,3)='v5_')::int AS policies
)
SELECT jsonb_build_object(
 'scope','production_metadata_only_no_changes',
 'migration_count',(SELECT n FROM h),
 'latest_migration',(SELECT latest FROM h),
 'stored_migration_sql_missing',(SELECT missing_sql FROM h),
 'migration_history_rollbacks_present',(SELECT has_rollback FROM h),
 'v5_version_collisions',(SELECT count(*) FROM v5 JOIN supabase_migrations.schema_migrations m USING (version)),
 'v4_core_tables',(SELECT n FROM v4),
 'v4_core_rls_enabled',(SELECT rls FROM v4),
 'v4_core_anon_direct_select',(SELECT anon_select FROM v4),
 'missing_required_columns',(SELECT cols FROM missing),
 'workspace_member_composite_pk',exists(
 SELECT 1 FROM pg_constraint con WHERE con.conrelid='public.workspace_members'::regclass
 AND con.contype='p' AND pg_get_constraintdef(con.oid)='PRIMARY KEY (workspace_id, user_id)'),
 'existing_v5_objects',(SELECT to_jsonb(c) FROM conflicts c),
 'actual_43_history_schema_replay_verified',false
)::text AS release_metadata;
