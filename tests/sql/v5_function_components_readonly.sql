-- Read-only, metadata-only hashes. Do not retrieve function bodies or row data.
-- Exact same query runs in Production (once for catalog capture) and disposable CI.
SELECT jsonb_build_object(
 'source','function_component_fingerprint',
 'functions',COALESCE(jsonb_agg(jsonb_build_object(
  'id',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  'body_h',md5(p.prosrc),
  'mode_h',md5(jsonb_build_array(p.prosecdef,p.provolatile)::text),
  'path_h',md5(to_jsonb(COALESCE(p.proconfig,ARRAY[]::text[]))::text),
  'grants_h',md5(jsonb_build_array(
     has_function_privilege('anon',p.oid,'EXECUTE'),
     has_function_privilege('authenticated',p.oid,'EXECUTE'),
     has_function_privilege('service_role',p.oid,'EXECUTE'))::text)
 ) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
)::text AS catalog
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','tutor_private') AND p.prokind='f';
