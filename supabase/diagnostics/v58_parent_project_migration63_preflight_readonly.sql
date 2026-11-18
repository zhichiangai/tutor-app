-- V5.8 Production 62 -> 63: metadata-only, read-only preflight.
-- No PII, tokens, row content, login, DDL, data changes, or remote CLI push.
-- Approved Production migration is NOT implied by a PASS here.
WITH history AS (
 SELECT count(*)::integer AS n, max(version) AS latest,
   count(distinct version)::integer AS unique_versions,
   count(*) FILTER (WHERE version='20261117010000')::integer AS candidate_collisions
 FROM supabase_migrations.schema_migrations
), rpc AS (
 SELECT p.prosrc,md5(p.prosrc) AS body_md5,p.prosecdef,p.provolatile,p.proconfig,
   has_function_privilege('anon',p.oid,'EXECUTE') AS anon_exec,
   has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_exec
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname='public' AND p.proname='v56_team_parent_finance_overview'
   AND p.oid='public.v56_team_parent_finance_overview(uuid,uuid,date)'::regprocedure
), acl AS (
 SELECT (SELECT relrowsecurity FROM pg_class
         WHERE oid='tutor_private.v5_team_lesson_fees'::regclass) AS fee_rls,
   has_table_privilege('anon','tutor_private.v5_team_lesson_fees','SELECT') AS fee_anon,
   has_table_privilege('authenticated','tutor_private.v5_team_lesson_fees','SELECT') AS fee_auth,
   (SELECT relrowsecurity FROM pg_class
    WHERE oid='public.v5_team_projects'::regclass) AS project_rls
)
SELECT jsonb_build_object(
 'scope','production_metadata_read_only',
 'status', CASE WHEN h.n=62 AND h.unique_versions=62 AND h.latest='20261110100000'
  AND h.candidate_collisions=0 AND r.body_md5='3569963e9d47af5d5e2acc728ccc8f17'
  AND r.prosecdef AND r.provolatile='s'
  AND coalesce('search_path=""'=ANY(r.proconfig),false)
  AND NOT r.anon_exec AND r.auth_exec
  AND position('sg.guardian_id=v_actor' in r.prosrc)>0
  AND position('v56_team_family_bridge_revocations' in r.prosrc)>0
  AND position('m.source=''direct''' in r.prosrc)>0
  AND position('m.source=''applied_credit''' in r.prosrc)>0
  AND position('''project_id'',pr.id' in r.prosrc)=0
  AND a.fee_rls AND NOT a.fee_anon AND NOT a.fee_auth AND a.project_rls
  THEN 'PASS' ELSE 'NO_GO' END,
 'migration_count',h.n,'latest_version',h.latest,
 'candidate_version_collisions',h.candidate_collisions,
 'parent_rpc_body_md5',r.body_md5,
 'parent_rpc_anon_executable',r.anon_exec,
 'parent_rpc_authenticated_executable',r.auth_exec,
 'parent_rpc_search_path_pinned',coalesce('search_path=""'=ANY(r.proconfig),false),
 'private_fee_rls',a.fee_rls,'private_fee_anon_select',a.fee_anon,
 'private_fee_authenticated_select',a.fee_auth,
 'project_rls',a.project_rls,
 'production_writes',0
)::text AS release_preflight_metadata
FROM history h CROSS JOIN rpc r CROSS JOIN acl a;
