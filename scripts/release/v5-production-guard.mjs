// V5 Production release: read-only guards. Workflow must load this from reviewed main.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';

const cmd=process.argv[2];
const root=resolve(process.argv[3]||'.');
const project='vctisuglfoxyuwlvyjee';
const read=p=>JSON.parse(readFileSync(join(root,p),'utf8'));
function sources(){
 const h=read('docs/v5/catalog/PRODUCTION_V4_43_HISTORY_SOURCE_MAP_20261110.json');
 const l=read('docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json');
 const a=read('docs/v5/V5_PRODUCTION_RELEASE_APPROVAL.json');
 assert.equal(h.expected_history_count,43);
 assert.equal(h.entries.length,43);
 assert.equal(l.migration_files.length,19);
 assert.equal(h.production_last_version,'20261103212647');
 assert.equal(l.approved_release,'NO_GO','Source-Lock unexpectedly changed');
 assert.equal(a.project_ref,project);
 assert.equal(a.base_migration_count,43);
 assert.equal(a.forward_migration_count,19);
 assert.equal(a.total_expected,62);
 const expected=[...h.entries.map(x=>x.version),...l.migration_files.map(x=>x.version)];
 assert.equal(new Set(expected).size,62);
 assert.deepEqual(expected,[...expected].sort());
 return {h,l,a};
}
function target(){
 const value=process.env.V5_PRODUCTION_DB_URL;
 assert.ok(value,'Protected environment DB URL missing');
 let u;
 try {
  u=new URL(value);
 } catch {
  // Never let Node's ERR_INVALID_URL diagnostics include the secret connection URL.
  throw new Error('Protected database URL is invalid');
 }
 assert.ok(['postgres:','postgresql:'].includes(u.protocol),'Database protocol denied');
 const username=decodeURIComponent(u.username);
 const direct=u.hostname==='db.'+project+'.supabase.co'&&username==='postgres';
 const pooler=u.hostname.endsWith('.pooler.supabase.com')&&username==='postgres.'+project;
 assert.ok(direct||pooler,'Database project identity mismatch');
 assert.ok(!u.port||u.port==='5432','Use session pooler port 5432');
 assert.equal(decodeURIComponent(u.pathname),'/postgres');
 assert.ok(u.password,'Database password missing');
 assert.ok(['require','verify-ca','verify-full'].includes(u.searchParams.get('sslmode')),'TLS required');
 console.log(JSON.stringify({status:'PASS',target_project:project,mode:direct?'direct':'session_pooler',credentials_printed:0}));
}
function history(phase,file){
 assert.ok(['before','after'].includes(phase));
 const {h,l}=sources();
 const rows=readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(x=>x.split('\t'));
 assert.equal(rows.length,phase==='before'?43:62,'Unexpected migration history count');
 assert.ok(rows.every(x=>x.length===3),'History query format mismatch');
 const original=new Map(h.entries.map(x=>[x.version,x]));
 const forwards=new Map(l.migration_files.map(x=>[x.version,x]));
 for(let i=0;i<rows.length;i++){
  const [version,name,hash]=rows[i],old=original.get(version);
  if(old){
   assert.equal(name,old.name,'V4 migration name drift: '+version);
   assert.equal(hash,old.canonical_md5,'V4 historical statement drift: '+version);
  }else{
   assert.equal(phase,'after','Unexpected version before update: '+version);
   const next=forwards.get(version);
   assert.ok(next,'Unexpected forward migration version: '+version);
   assert.equal(name,basename(next.path).slice(15,-4),'V5 migration name drift: '+version);
  }
  if(i)assert.ok(rows[i-1][0]<version,'Migration history order drift');
 }
 console.log(JSON.stringify({status:'PASS',phase,versions:rows.length,original:43,
  forward:phase==='after'?19:0,pii_printed:0}));
}
function metadata(phase,file){
 assert.ok(['before','after'].includes(phase));
 const row=JSON.parse(readFileSync(file,'utf8').trim());
 for(const k of ['v4_core_rls','v5_tables','v5_rls','anon_v5_select','anon_v5_rpc']){
  assert.ok(Number.isSafeInteger(row[k])&&row[k]>=0,'Invalid metadata field: '+k);
 }
 assert.equal(row.v4_core_rls,8,'V4 core RLS mismatch');
 assert.equal(row.anon_v5_select,0,'Anonymous direct V5 table grants detected');
 assert.equal(row.anon_v5_rpc,0,'Anonymous V5 RPC execute grant detected');
 if(phase==='before')assert.equal(row.v5_tables,0,'V5 objects exist before release');
 else{
  assert.ok(row.v5_tables>=27,'V5 schema unexpectedly incomplete');
  assert.equal(row.v5_rls,row.v5_tables,'Every V5 table must have RLS enabled');
 }
 console.log(JSON.stringify({status:'PASS',phase,core_rls:row.v4_core_rls,
  v5_tables:row.v5_tables,v5_rls:row.v5_rls,anonymous_exposure:0}));
}
function approve(){
 const {a}=sources();
 assert.equal(a.status,'GO','V5 approval record is BLOCKED');
 assert.equal(a.approval_decision?.authorized_by,'product_owner');
 assert.ok(typeof a.approval_decision?.reason==='string'&&a.approval_decision.reason.length>=20);
 const required=[
  'CI_real_43_history_62_replay','CI_populated_V4_migration',
  'CI_role_and_finance_isolation','live_V4_source_hashes',
  'live_V4_schema_catalog','financial_gross_net_presentation',
  'Production_19_migration_CLI_dry_run',
  'Vercel_production_project_target_rollback',
  'external_notification_bank_oauth_side_effects'
 ];
 for(const name of required)assert.equal(a.evidence?.[name],'PASS','Approval missing: '+name);
 const sha=process.env.V5_RELEASE_SHA;
 assert.match(sha||'',/^[0-9a-f]{40}$/);
 assert.equal(process.env.V5_APPROVED_RELEASE_SHA,sha,'Approved SHA mismatch');
 assert.equal(process.env.V5_WRITE_ENABLED,'GO','Production write switch disabled');
 assert.equal(process.env.V5_CONFIRMATION,'APPLY_V5_19_'+sha,'Confirmation phrase mismatch');
 console.log(JSON.stringify({status:'GO_GATE_PASS',project,release_sha:sha}));
}
// Separately scoped Product Alpha gate. Never reinterpret the commercial release
// approval as PASS: existing Source-Lock NO_GO and commercial BLOCKED remain intact.
// The approval record is loaded from trusted Main (workflow checkout working dir),
// not from the unmerged V5 release branch.
function approveAlpha(){
 const {a,l}=sources();
 const alpha=JSON.parse(readFileSync(join(process.cwd(),
  'docs/v5/V5_PRODUCTION_ALPHA_APPROVAL_20261112.json'),'utf8'));
 assert.equal(a.status,'BLOCKED','Commercial approval cannot be upgraded implicitly');
 assert.equal(l.approved_release,'NO_GO','Frozen source-lock must remain NO_GO');
 assert.equal(alpha.schema,1);
 assert.equal(alpha.status,'ALPHA_GO');
 assert.equal(alpha.scope,'INTERNAL_PRODUCTION_ALPHA_NO_PLATFORM_CHARGES');
 assert.equal(alpha.production_project_ref,project);
 assert.equal(alpha.original_commercial_approval,'BLOCKED');
 assert.equal(alpha.source_lock_approved_release,'NO_GO');
 assert.equal(alpha.base_migrations,43);
 assert.equal(alpha.forward_migrations,19);
 assert.equal(alpha.expected_migrations,62);
 const restrictions=[
  'no_paid_platform_subscriptions',
  'no_automatic_bank_transfers_or_refunds',
  'manual_lesson_accounting_is_not_bank_verification',
  'internal_test_accounts_only',
  'no_real_customers_before_post_release_acceptance',
  'stop_if_migration_or_rls_postflight_fails',
  'protected_environment_review_required',
  'preserve_v4_history_and_existing_rows'
 ];
 for(const field of restrictions)assert.equal(alpha.restrictions?.[field],true,
  'Alpha restriction missing: '+field);
 for(const key of [
  'release_ci','production_43_history_and_cli_preflight',
  'current_v4_rls_anonymous_baseline','production_vercel_project_sha',
  'internal_accounting_code_and_jwt_tests',
  'repository_sql_no_external_payment_or_mail_calls'
 ])assert.equal(alpha.evidence?.[key],'PASS','Alpha evidence missing: '+key);
 assert.equal(alpha.evidence?.independent_gas_and_provider_operations,'PARTIAL');
 assert.equal(alpha.evidence?.full_production_database_restore,'NOT_TESTED');
 assert.equal(alpha.evidence?.production_three_role_team_gui,'NOT_TESTED');
 assert.equal(alpha.evidence?.commercial_bank_reconciliation,'NOT_APPLICABLE');
 assert.equal(alpha.authorization?.authorized_by,'product_owner');
 assert.ok(typeof alpha.authorization?.decision==='string'&&
  alpha.authorization.decision.length>=80);
 assert.ok(typeof alpha.authorization?.risk_acceptance==='string'&&
  alpha.authorization.risk_acceptance.length>=100);
 const sha=process.env.V5_RELEASE_SHA;
 assert.match(sha||'',/^[0-9a-f]{40}$/);
 assert.equal(alpha.release_sha,sha,'Alpha approval release SHA mismatch');
 assert.equal(process.env.V5_APPROVED_RELEASE_SHA,sha,'Protected Environment SHA mismatch');
 assert.equal(process.env.V5_OPERATION,'alpha-apply','Alpha-only operation required');
 assert.equal(process.env.V5_WRITE_ENABLED,'GO','Production write switch disabled');
 assert.equal(process.env.V5_CONFIRMATION,'ALPHA_APPLY_V5_19_'+sha,
  'Explicit Alpha confirmation mismatch');
 console.log(JSON.stringify({status:'ALPHA_GO_GATE_PASS',project,release_sha:sha,
  scope:alpha.scope,commercial_release:'BLOCKED'}));
}
if(cmd==='source'){
 const {a}=sources();
 const pkg=join(root,'scripts/release/package-v5-43-plus-19.mjs');
 const out=JSON.parse(execFileSync(process.execPath,[pkg,'check'],
  {encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
 assert.equal(out.result,'PASS');
 assert.equal(out.total,62);
 assert.equal(out.production_writes,0);
 console.log(JSON.stringify({status:'PASS',phase:'offline_source',migrations:62,
  approval:a.status,remote_writes:0}));
}else if(cmd==='target')target();
else if(cmd==='history')history(process.argv[4],process.argv[5]);
else if(cmd==='metadata')metadata(process.argv[4],process.argv[5]);
else if(cmd==='approve')approve();
else if(cmd==='alpha-approve')approveAlpha();
else throw Error('Usage: source|target|history|approve|alpha-approve');
