-- SYNTHETIC CI ONLY: compare CHECK constraints via PostgreSQL's deparsed
-- canonical expression, not pg_dump bracket layout or raw conbin OID fields.
-- Cross-database restore can reassign OIDs to functions/types while retaining
-- precisely the same CHECK expression semantics.
-- Includes validation, inheritance and local flags; emits only digests and
-- CHECK object identities for sanitized mismatch diagnostics, never SQL/rows.
WITH checks AS (
  SELECT
    format('%I.%I.%I', n.nspname, c.relname, con.conname) AS object_name,
    format('%s:%s:%s:%s',
      con.convalidated, con.connoinherit, con.conislocal,
      pg_get_expr(con.conbin, con.conrelid, true)
    ) AS canonical_expression
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
    AND con.contype = 'c'
)
SELECT jsonb_build_object(
  'count', count(*),
  'md5', md5(coalesce(string_agg(
    object_name || ':' || canonical_expression,
    E'\n' ORDER BY object_name
  ), '')),
  'objects', coalesce(jsonb_object_agg(
    object_name, md5(canonical_expression)
  ), '{}'::jsonb)
)::text
FROM checks;
