-- Fixed read-only production metadata verification from trusted Main workflow.
-- No student, Auth, payment rows or secret values are read.
select jsonb_build_object(
 'v4_core_rls',(
  select count(*) from pg_tables
  where schemaname='public'
   and tablename in (
    'workspaces','workspace_members','profiles','students',
    'student_guardians','lesson_records','payment_batches','payment_batch_items'
   ) and rowsecurity
 ),
 'v5_tables',(
  select count(*) from pg_tables
  where schemaname in ('public','tutor_private') and tablename ~ '^v5'
 ),
 'v5_rls',(
  select count(*) from pg_tables
  where schemaname in ('public','tutor_private') and tablename ~ '^v5' and rowsecurity
 ),
 'anon_v5_select',(
  select count(*) from pg_tables
  where schemaname in ('public','tutor_private') and tablename ~ '^v5'
   and has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT')
 ),
 'anon_v5_rpc',(
  select count(*) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname ~ '^v5'
   and has_function_privilege('anon',p.oid,'EXECUTE')
 )
)::text;
