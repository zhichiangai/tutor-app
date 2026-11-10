-- TEST ONLY: hash effective object ACLs; do not emit grants or role data.
-- Platform DEFAULT ACL entries are intentionally excluded from this rehearsal.
SELECT jsonb_build_object(
  'schemas', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        n.nspname || ':' || coalesce(n.nspacl::text, 'NULL'),
        E'\n' ORDER BY n.nspname
      ), ''))
    )
    FROM pg_namespace n
    WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations')
  ),
  'relations', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        n.nspname || '.' || c.relname || ':' || coalesce(c.relacl::text, 'NULL'),
        E'\n' ORDER BY n.nspname, c.relname
      ), ''))
    )
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations')
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  ),
  'functions', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || coalesce(p.proacl::text, 'NULL'),
        E'\n' ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
      ), ''))
    )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations')
  )
)::text;
