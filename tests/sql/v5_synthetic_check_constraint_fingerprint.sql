-- TEST ONLY: compare parsed CHECK trees, not pg_dump's redundant-parenthesis formatting.
-- Emits object counts and a hash; no table rows or expression text are returned.
SELECT jsonb_build_object(
  'count', count(*),
  'md5', md5(coalesce(string_agg(
    format('%s.%s:%s:%s:%s:%s',
      n.nspname, c.relname, con.conname, con.convalidated,
      con.connoinherit, con.conbin::text
    ), E'\n' ORDER BY n.nspname, c.relname, con.conname
  ), ''))
)::text
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
  AND con.contype = 'c';
