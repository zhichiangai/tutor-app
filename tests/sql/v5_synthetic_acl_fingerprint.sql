-- TEST ONLY: hash effective non-owner object ACLs; do not emit grants or role data.
-- Platform DEFAULT ACL entries are intentionally excluded from this rehearsal.
SELECT jsonb_build_object(
  'schemas', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s', acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname AS object_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) exploded
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
        AND exploded.grantee <> n.nspowner
    ) acl
  ),
  'relations', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s', acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname || '.' || c.relname AS object_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(
        CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner
      ))) exploded
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
        AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND exploded.grantee <> c.relowner
    ) acl
  ),
  'functions', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s', acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS object_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) exploded
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private', 'auth', 'supabase_migrations', 'extensions')
        AND exploded.grantee <> p.proowner
    ) acl
  )
)::text;
