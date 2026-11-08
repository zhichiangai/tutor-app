-- Metadata-only V4 schema fingerprint comparator (read-only).
-- Do not read business rows, user identities, Auth secrets or service keys.
-- Intended for disposable CI; the saved formal catalog was captured with
-- exactly the same SELECT through a read-only Supabase connection.
select jsonb_build_object(
 'snapshot_schema',1,
 'source','production_catalog_metadata_only',
 'captured_date','2026-11-08',
 'hash_algorithm','md5',
 'tables',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
   select jsonb_build_object(
    'id',n.nspname||'.'||c.relname,
    'rls',c.relrowsecurity,
    'h',md5(jsonb_build_array(c.relrowsecurity,c.relforcerowsecurity,
     has_table_privilege('anon',c.oid,'SELECT'),
     has_table_privilege('authenticated',c.oid,'SELECT'),
     has_table_privilege('authenticated',c.oid,'INSERT'),
     has_table_privilege('authenticated',c.oid,'UPDATE'),
     has_table_privilege('authenticated',c.oid,'DELETE'))::text)) x
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','tutor_private') and c.relkind in ('r','p')
 )t),
 'columns',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
   select jsonb_build_object(
    'id',n.nspname||'.'||c.relname||'.'||a.attname,
    'h',md5(jsonb_build_array(format_type(a.atttypid,a.atttypmod),
     a.attnotnull,a.attidentity,a.attgenerated,
     coalesce(pg_get_expr(d.adbin,d.adrelid),''),
     a.attcollation::regcollation::text)::text)) x
   from pg_attribute a join pg_class c on c.oid=a.attrelid
   join pg_namespace n on n.oid=c.relnamespace
   left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where n.nspname in ('public','tutor_private') and c.relkind in ('r','p')
     and a.attnum>0 and not a.attisdropped
 )t),
 'constraints',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
   select jsonb_build_object(
    'id',n.nspname||'.'||c.relname||'.'||co.conname,
    'h',md5(jsonb_build_array(co.contype,pg_get_constraintdef(co.oid,true))::text)) x
   from pg_constraint co join pg_class c on c.oid=co.conrelid
   join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','tutor_private') and c.relkind in ('r','p')
 )t),
 'indexes',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
  select jsonb_build_object('id',schemaname||'.'||tablename||'.'||indexname,
   'h',md5(indexdef)) x from pg_indexes
  where schemaname in ('public','tutor_private')
 )t),
 'policies',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
  select jsonb_build_object(
   'id',schemaname||'.'||tablename||'.'||policyname,
   'h',md5(jsonb_build_array(permissive,roles,cmd,coalesce(qual,''),coalesce(with_check,''))::text)) x
  from pg_policies where schemaname in ('public','tutor_private')
 )t),
 'triggers',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
  select jsonb_build_object(
    'id',n.nspname||'.'||c.relname||'.'||t.tgname,
    'h',md5(jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid,true))::text)) x
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','tutor_private') and not t.tgisinternal
 )t),
 'functions',(select coalesce(jsonb_agg(x order by x->>'id'),'[]'::jsonb) from (
  select jsonb_build_object(
    'id',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
    'h',md5(jsonb_build_array(p.prosecdef,p.provolatile,
      coalesce(p.proconfig,array[]::text[]),p.prosrc,
      has_function_privilege('anon',p.oid,'EXECUTE'),
      has_function_privilege('authenticated',p.oid,'EXECUTE'),
      has_function_privilege('service_role',p.oid,'EXECUTE'))::text)) x
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','tutor_private') and p.prokind='f'
 )t)
)::text as catalog;
