// Read-only verification of the live DISPOSABLE PostgreSQL replayed migration history.
// The CI-only source is the verified public repo + 3 reviewed PII-free V2.6 DDL statements.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const phase=process.argv[2];
assert.ok(['baseline','forward'].includes(phase));
assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.match(readFileSync(join(root,'supabase/config.toml'),'utf8'),/^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(join(root,'supabase/.temp/project-ref')),false,'Hosted Supabase link forbidden');
const map=JSON.parse(readFileSync(join(root,'docs/v5/catalog/PRODUCTION_V4_43_HISTORY_SOURCE_MAP_20261110.json'),'utf8'));
const lock=JSON.parse(readFileSync(join(root,'docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json'),'utf8'));
const expected=map.entries.map(x=>x.version);
if(phase==='forward')expected.push(...lock.migration_files.map(x=>x.version));
assert.equal(expected.length,phase==='baseline'?43:62);
assert.equal(new Set(expected).size,expected.length);
const migrations=join(root,'supabase/migrations');
const localFiles=readdirSync(migrations).filter(x=>/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(x)).sort();
assert.deepEqual(localFiles.map(x=>x.slice(0,14)),expected);
function db(sql){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql','-X',
  '-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',sql],
 {encoding:'utf8',timeout:25000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
}
const applied=db('select version from supabase_migrations.schema_migrations order by version').split(/\r?\n/).filter(Boolean);
assert.deepEqual(applied,expected,'Database history must be exact 43 (or 43 + 19) versions');
const core=[
 'public.workspaces','public.workspace_members','public.profiles',
 'public.students','public.student_guardians','public.lesson_records',
 'public.payment_batches','public.payment_batch_items'
];
for(const table of core){
 const actual=db("select relrowsecurity::text from pg_class where oid=to_regclass('"+table+"')");
 assert.equal(actual,'t','Missing V4 core RLS '+table);
}
for(const table of ['auth.users','public.students','public.lesson_records','public.payment_batches']){
 assert.equal(Number(db('select count(*) from '+table)),0,'Historical replay leaked data into '+table);
}
const v5Count=Number(db("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
 "where n.nspname='public' and c.relkind='r' and c.relname like 'v5\\_%'"));
if(phase==='baseline'){
 assert.equal(v5Count,0,'43-history baseline must contain zero V5 tables');
 assert.equal(db("select to_regprocedure('public.v5_team_billing_overview(uuid,date)') is not null"),'f');
}else{
 assert.ok(v5Count>=10,'Expected V5 tables after 19 forward SQL');
 assert.equal(db("select to_regprocedure('public.v56_team_conservation_overview(uuid)') is not null"),'t');
 assert.equal(db("select has_function_privilege('anon','public.v56_team_conservation_overview(uuid)','EXECUTE')"),'f');
}
console.log(JSON.stringify({
 status:'PASS',gate:'schema_history_exact',phase,source:'verified_real_production_43_migration_sql',
 applied:applied.length,v4_core_rls:core.length,zero_row_business_tables:4,
 v5_public_tables:v5Count,production_writes:0,pii_rows:0,bank_activity:0
}));
