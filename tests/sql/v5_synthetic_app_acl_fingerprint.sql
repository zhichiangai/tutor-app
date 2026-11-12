-- TEST ONLY: strict app-owned schema ACL and owner parity after selected-schema restore.
-- Excludes Supabase-managed auth, extensions and migration-history schema objects:
-- their protected owners cannot be recreated by a restricted logical pg_restore.
-- Includes owner identity, explicit/effective non-owner grants, role and grantability.
-- Never emits privileges or identifiers to CI logs; only summary fingerprints.
-- Excludes platform DEFAULT ACL entries (separately documented release limitation).
SELECT jsonb_build_object(
  'schemas', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s:%s', acl.object_name, acl.owner_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname AS object_name,
        owner.rolname AS owner_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) exploded
      JOIN pg_roles owner ON owner.oid = n.nspowner
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private')
        AND exploded.grantee <> n.nspowner
    ) acl
  ),
  'relations', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s:%s', acl.object_name, acl.owner_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname || '.' || c.relname AS object_name,
        owner.rolname AS owner_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(
        CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner
      ))) exploded
      JOIN pg_roles owner ON owner.oid = c.relowner
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private')
        AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        AND exploded.grantee <> c.relowner
    ) acl
  ),
  'functions', (
    SELECT jsonb_build_object(
      'count', count(*),
      'md5', md5(coalesce(string_agg(
        format('%s:%s:%s:%s:%s', acl.object_name, acl.owner_name, acl.grantee_name, acl.privilege_type, acl.is_grantable),
        E'\n' ORDER BY acl.object_name, acl.grantee_name, acl.privilege_type, acl.is_grantable
      ), ''))
    )
    FROM (
      SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS object_name,
        owner.rolname AS owner_name,
        coalesce(grantee.rolname, 'PUBLIC') AS grantee_name,
        exploded.privilege_type, exploded.is_grantable
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) exploded
      JOIN pg_roles owner ON owner.oid = p.proowner
      LEFT JOIN pg_roles grantee ON grantee.oid = exploded.grantee
      WHERE n.nspname IN ('public', 'tutor_private')
        AND exploded.grantee <> p.proowner
    ) acl
  )
)::text;
