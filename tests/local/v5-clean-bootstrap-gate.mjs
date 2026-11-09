// Clean V4 + V5 bootstrap gate. Runs ONLY after supabase db reset --local
// --no-seed inside disposable GitHub Actions; never targets a hosted database.
// All checks are schema/privilege/zero-row aggregates: no private records.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const cfg=readFileSync(join(root,'supabase/config.toml'),'utf8');
assert.equal(process.env.CI,'true','Only disposable CI may run this gate');
assert.equal(process.env.V4_E2E_LOCAL,'1','Isolated local E2E guard required');
assert.match(cfg,/^project_id = "tutor_v4_isolated"$/m);
// The workflow checks there is no hosted link BEFORE starting local services.
// Every database query below uses docker exec against the named disposable CI
// container, never a CLI command targeting a linked/remote database.

const directory=join(root,'supabase/migrations');
const files=readdirSync(directory).filter(name=>/^[0-9]{14}_.+\.sql$/.test(name)).sort();
const versions=files.map(name=>name.slice(0,14));
assert.equal(new Set(versions).size,versions.length,'Migration versions must be unique');
assert.ok(files.length>=46,'Expected the complete V4 + V5 replay baseline');
const v5Files=files.filter(name=>name.includes('_v5_'));
assert.ok(v5Files.length>=9,'Nine V5.1-V5.4 migration files are required');

console.log('V5 clean bootstrap: querying disposable Postgres catalog');
function db(sql){
 const output=execFileSync('docker',[
  'exec','supabase_db_tutor_v4_isolated','psql','-X',
  '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t','-c',sql
 ],{
  cwd:root,encoding:'utf8',timeout:20000,maxBuffer:1024*1024,
  stdio:['ignore','pipe','pipe']
 });
 return output.trim();
}
function lines(query){
 const text=db(query);
 return text?text.split(/\r?\n/).filter(Boolean):[];
}

// Verify every file was replayed once, in exactly the same version set.
const applied=lines('select version from supabase_migrations.schema_migrations order by version');
assert.deepEqual(applied,versions,'Fresh DB migration history differs from the 46-file repository replay');

// Derive the V5 table inventory from reviewed migration source, not a
// hard-coded schema guess. The database catalog must contain every one.
const expectedV5=new Set();
for(const file of v5Files){
 const sql=readFileSync(join(directory,file),'utf8');
 const re=/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(public|tutor_private)\.(v5_[a-z0-9_]+)/gi;
 for(const match of sql.matchAll(re))expectedV5.add(match[1]+'.'+match[2]);
}
assert.ok(expectedV5.size>=27,'V5 public/private table definition set unexpectedly small');

const catalog=lines(
 "select n.nspname||'.'||c.relname||'|'||c.relrowsecurity::text "+
 "from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
 "where n.nspname in ('public','tutor_private') "+
 "and c.relkind in ('r','p') order by n.nspname,c.relname"
);
const rls=new Map(catalog.map(line=>line.split('|')));
const core=[
 'public.workspaces','public.workspace_members','public.profiles',
 'public.students','public.student_guardians','public.lesson_records',
 'public.payment_batches','public.payment_batch_items'
];
for(const table of [...core,...expectedV5]){
 assert.equal(rls.get(table),'true','Missing RLS or table: '+table);
}

// No anonymous direct table reads on V5, and no direct browser access to
// tutor_private.v5_* ledger/audit tables. RPCs remain subject to separate JWT
// and RLS/manager checks in the real GoTrue/PostgREST/Chromium suite.
const exposed=lines(
 "select n.nspname||'.'||c.relname "+
 "from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
 "where n.nspname in ('public','tutor_private') and c.relname like 'v5\\_%' "+
 "and c.relkind in ('r','p') and "+
 "(has_table_privilege('anon',c.oid,'SELECT') or "+
 " (n.nspname='tutor_private' and "+
 " has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) "+
 "order by n.nspname,c.relname"
);
assert.deepEqual(exposed,[],'Browser roles have direct V5 table privileges unexpectedly');

// Explicit service-only operator functions must not be callable with the
// browser roles. Public manager RPCs may be authenticated but never anon.
const sensitiveRpcs=[
 'public.v5_admin_apply_plan(uuid,text,integer,text,text)',
 'public.v5_admin_release_qa_seats(uuid,integer,uuid,text)',
 'public.v5_confirm_team_lesson_fee(uuid,bigint)',
 'public.v5_team_billing_overview(uuid,date)',
 'public.v5_team_payment_overview(uuid,date)',
 'public.v5_apply_team_advance_credit(uuid,jsonb,text)',
 'public.v5_team_operations_overview(uuid,date)',
 'public.v56_void_team_pending_payment(uuid,text,text)',
 'public.v56_correct_team_payment_metadata(uuid,text,text,text,text)',
 'public.v56_request_team_credit_refund(uuid,bigint,text,text)',
 'public.v56_decide_team_credit_refund(uuid,boolean,text)',
 'public.v56_record_team_refund_manual_paid(uuid,text,date,text)',
 'public.v56_team_adjustment_overview(uuid,date)'
];
for(const signature of sensitiveRpcs){
 const escaped=signature.replaceAll("'","''");
 const row=db("select coalesce(to_regprocedure('"+escaped+"')::text,'MISSING') || '|' || "+
  "coalesce(has_function_privilege('anon',to_regprocedure('"+escaped+"'),'EXECUTE')::text,'MISSING')");
 const [actual,anon]=row.split('|');
 assert.notEqual(actual,'MISSING','Missing required V5 RPC: '+signature);
 assert.equal(anon,'false','Anonymous execution was enabled: '+signature);
}
for(const signature of sensitiveRpcs.slice(0,2)){
 const escaped=signature.replaceAll("'","''");
 const allowed=db("select has_function_privilege('authenticated',to_regprocedure('"+
   escaped+"'),'EXECUTE')::text");
 assert.equal(allowed,'false','Admin-only RPC exposed to authenticated role: '+signature);
}

// V5.6 correction/void/refund records are private and deliberately not
// matched by the historical v5_ prefix inventory.
const v56Private=[
 'tutor_private.v56_team_pending_payment_voids',
 'tutor_private.v56_team_payment_corrections',
 'tutor_private.v56_team_credit_refund_requests',
 'tutor_private.v56_team_credit_refund_events'
];
for(const name of v56Private){
 assert.equal(rls.get(name),'true','V5.6 private table missing RLS: '+name);
 const denied=db("select (not has_table_privilege('authenticated','"+name+
   "','SELECT,INSERT,UPDATE,DELETE'))::text");
 assert.equal(denied,'true','Browser should never directly read V5.6 private ledger: '+name);
}
// No test accounts, family/student links, lessons, or payments should be
// imported into the fresh baseline. A later explicit synthetic seed is allowed.
const cleanTables=[
 'auth.users','public.students','public.lesson_records','public.payment_batches',
 'public.v5_teams','public.v5_team_students','public.v5_team_lessons',
 'tutor_private.v5_team_payment_reports'
];
for(const table of cleanTables){
 const count=Number(db('select count(*) from '+table));
 assert.equal(count,0,'Fresh schema unexpectedly contains test rows: '+table);
}
const observedV5=[...rls.keys()].filter(table=>table.startsWith('public.v5_')||
 table.startsWith('tutor_private.v5_')).sort();
assert.deepEqual(observedV5,[...expectedV5].sort(),
 'V5 catalog must match migration-defined tables');

console.log(JSON.stringify({
 status:'PASS',
 scope:'disposable-local-only',
 migration_files:files.length,
 applied_versions:applied.length,
 v5_migration_files:v5Files.length,
 v5_rls_tables:expectedV5.size,
 v4_core_rls_tables:core.length,
 anon_exposures:exposed.length,
 zero_row_business_tables:cleanTables.length,
 production_writes:0
}));
