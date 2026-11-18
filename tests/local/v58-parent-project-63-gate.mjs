// Release candidate 62 -> 63 PostgreSQL gate.
// This script NEVER connects to hosted Supabase. It queries ONLY the named
// disposable CI Docker database, and outputs schema metadata / aggregate counts.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const phase=process.argv[2];
assert.ok(['before','after'].includes(phase),'Specify before or after');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.CI,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.ok(process.env.RUNNER_TEMP,'Missing ephemeral CI workspace');
const config=readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8');
assert.match(config,/^project_id = "tutor_v4_isolated"$/m);
assert.ok(!existsSync(new URL('../../supabase/.temp/project-ref',import.meta.url)),
 'Refusing a Supabase checkout linked to hosted project');

const container='supabase_db_tutor_v4_isolated';
function db(sql){
 return execFileSync('docker',[
  'exec',container,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1',
  '-U','postgres','-d','postgres','-c',sql
 ],{encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,
   stdio:['ignore','pipe','pipe']}).trim();
}
function metadata(){
 return JSON.parse(db(`
 select jsonb_build_object(
  'migrations',(select count(*) from supabase_migrations.schema_migrations),
  'latest',(select max(version) from supabase_migrations.schema_migrations),
  'distinct_versions',(select count(distinct version) from supabase_migrations.schema_migrations),
  'rpc',(
   select jsonb_build_object(
    'security_definer',p.prosecdef,
    'search_path_pinned',coalesce('search_path=""'=any(p.proconfig),false),
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'signed_in_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'project_scoped',position('''project_id'',pr.id' in p.prosrc)>0
      and position('pr.team_id=f.team_id' in p.prosrc)>0,
    'refund_manual_direct',position('m.source=''direct''' in p.prosrc)>0,
    'refund_manual_applied',position('m.source=''applied_credit''' in p.prosrc)>0,
    'guardian_link_current',position('sg.guardian_id=v_actor' in p.prosrc)>0,
    'revoked_consent_denied',position('v56_team_family_bridge_revocations' in p.prosrc)>0
   )
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='v56_team_parent_finance_overview'
  ),
  'private_fee_rls',(select relrowsecurity from pg_class where oid='tutor_private.v5_team_lesson_fees'::regclass),
  'anon_fee_read',has_table_privilege('anon','tutor_private.v5_team_lesson_fees','SELECT'),
  'authenticated_fee_read',has_table_privilege('authenticated','tutor_private.v5_team_lesson_fees','SELECT'),
  'project_rls',(select relrowsecurity from pg_class where oid='public.v5_team_projects'::regclass)
 )::text
 `));
}
const snapshotSql=`
 select jsonb_build_object(
  'fees',(select count(*) from tutor_private.v5_team_lesson_fees),
  'payments',(select count(*) from tutor_private.v5_team_payment_reports),
  'manual_refunds',(select count(*) from tutor_private.v56_team_allocated_refund_manual_payouts),
  'lessons',(select count(*) from public.v5_team_lessons)
 )::text
`;
const f=join(process.env.RUNNER_TEMP,'v58-project-62-rowcounts.json');
const result=metadata();
assert.equal(result.migrations,result.distinct_versions,'Duplicate migration history version');
assert.equal(result.rpc?.security_definer,true,'Parent RPC privilege mode drift');
assert.equal(result.rpc?.search_path_pinned,true,'Parent RPC search_path not pinned');
assert.equal(result.rpc?.anon_execute,false,'Anon cannot execute parent finance');
assert.equal(result.rpc?.signed_in_execute,true,'Authorised parent RPC must be callable after checking guardian');
assert.equal(result.rpc?.refund_manual_direct,true,'Direct refund manual payout status lost');
assert.equal(result.rpc?.refund_manual_applied,true,'Applied credit manual payout status lost');
assert.equal(result.rpc?.guardian_link_current,true,'Current V4 guardian link guard lost');
assert.equal(result.rpc?.revoked_consent_denied,true,'Revocation guard lost');
assert.equal(result.private_fee_rls,true);
assert.equal(result.anon_fee_read,false);
assert.equal(result.authenticated_fee_read,false);
assert.equal(result.project_rls,true);
if(phase==='before'){
 assert.equal(result.migrations,62,'Expected actual 43-history +19 forward baseline');
 assert.equal(result.latest,'20261110100000','Unexpected prior migration head');
 assert.equal(result.rpc.project_scoped,false,'Project field already present before 63');
 writeFileSync(f,db(snapshotSql)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({phase,status:'PASS',migration_count:62,
  project_field:false,production_writes:0,pii_rows:0}));
}else{
 const version=process.env.V58_LOCAL_MIGRATION_VERSION||'';
 assert.match(version,/^[0-9]{14}$/,'Missing locally generated CLI migration ID');
 assert.ok(version>'20261110100000');
 assert.equal(result.migrations,63,'Exactly one new forward version required');
 assert.equal(result.latest,version,'Local 63rd version mismatch');
 assert.equal(result.rpc.project_scoped,true,'Team-verified project fields missing');
 assert.ok(existsSync(f),'Missing pre-upgrade aggregate snapshot');
 assert.equal(db(snapshotSql)+'\n',readFileSync(f,'utf8'),
  'Forward-only RPC changed synthetic business row counts');
 console.log(JSON.stringify({phase,status:'PASS',migration_count:63,
  project_field:true,existing_rows_unchanged:true,
  anon_exposed:false,production_writes:0,pii_rows:0}));
}
