-- SYNTHETIC CI ONLY: every public/tutor_private app object owner, not merely
-- objects with explicit non-owner GRANTs. SECURITY DEFINER ownership matters.
-- Returns counts and a digest only; do not log role or object names.
WITH owned_objects AS (
  SELECT 'schema'::text AS kind, n.nspname::text AS ident,
         pg_get_userbyid(n.nspowner) AS owner, false AS is_definer
  FROM pg_namespace n
  WHERE n.nspname IN ('public', 'tutor_private')
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname,
         pg_get_userbyid(c.relowner), false
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'tutor_private')
    AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' ||
         pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_userbyid(p.proowner), p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'tutor_private')
  UNION ALL
  SELECT 'type', n.nspname || '.' || t.typname,
         pg_get_userbyid(t.typowner), false
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname IN ('public', 'tutor_private')
    AND t.typtype IN ('b', 'c', 'd', 'e', 'm', 'r')
)
SELECT jsonb_build_object(
  'count', count(*),
  'security_definer_functions', count(*) FILTER (WHERE kind = 'function' AND is_definer),
  'md5', md5(coalesce(string_agg(
    format('%s:%s:%s:%s', kind, ident, owner, is_definer),
    E'\n' ORDER BY kind, ident, owner, is_definer
  ), ''))
)::text
FROM owned_objects;
