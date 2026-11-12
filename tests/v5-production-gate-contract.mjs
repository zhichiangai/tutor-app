import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';

const guard=new URL('../scripts/release/v5-production-guard.mjs',import.meta.url);
const run=(command,args=[],env={})=>execFileSync(process.execPath,[guard.pathname,command,...args],
 {encoding:'utf8',timeout:5000,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
test('production URL guard refuses other project, transaction pooler, missing TLS',()=>{
 assert.throws(()=>run('target',['.'],{V5_PRODUCTION_DB_URL:'postgresql://postgres:synthetic@db.other.supabase.co:5432/postgres?sslmode=require'}));
 assert.throws(()=>run('target',['.'],{V5_PRODUCTION_DB_URL:'postgresql://postgres.vctisuglfoxyuwlvyjee:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require'}));
 assert.throws(()=>run('target',['.'],{V5_PRODUCTION_DB_URL:'postgresql://postgres:synthetic@db.vctisuglfoxyuwlvyjee.supabase.co:5432/postgres?sslmode=disable'}));
});
test('malformed protected URL diagnostics never print secret bytes',()=>{
 const marker='PRODUCTION_SECRET_MARKER_DO_NOT_LOG';
 const invalid='postgresql://postgres:'+marker+'@[';
 let failure;
 try {
  run('target',['.'],{V5_PRODUCTION_DB_URL:invalid});
 } catch (error) {
  failure=error;
 }
 assert.ok(failure,'Malformed URL must fail closed');
 const output=String(failure.stderr||'')+'\n'+String(failure.stdout||'')+'\n'+String(failure.message||'');
 assert.doesNotMatch(output,/PRODUCTION_SECRET_MARKER_DO_NOT_LOG/);
 assert.match(output,/Protected database URL is invalid/);
});

test('production URL guard accepts only intended direct or session pooler with TLS',()=>{
 const direct='postgresql://postgres:synthetic@db.vctisuglfoxyuwlvyjee.supabase.co:5432/postgres?sslmode=require';
 assert.match(run('target',['.'],{V5_PRODUCTION_DB_URL:direct}),/target_project/);
 const pooler='postgresql://postgres.vctisuglfoxyuwlvyjee:synthetic@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
 assert.match(run('target',['.'],{V5_PRODUCTION_DB_URL:pooler}),/session_pooler/);
});
test('unknown gate modes, missing signed records and malformed history are denied',()=>{
 assert.throws(()=>run('something-unexpected'));
 const dir=mkdtempSync(join(tmpdir(),'tutor-v5-gate-'));
 try {
  writeFileSync(join(dir,'history.tsv'),'20261103212647\twrong\tdeadbeef\n');
  assert.throws(()=>run('history',[dir,'before',join(dir,'history.tsv')]));
  assert.throws(()=>run('approve',[dir],{V5_APPROVED_RELEASE_SHA:'0'.repeat(40)}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('RLS metadata preflight requires 8 V4 core protected tables and zero V5 before release',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tutor-v5-metadata-'));
 try{
  const target=join(dir,'metadata.json');
  writeFileSync(target,JSON.stringify({v4_core_rls:8,v5_tables:0,v5_rls:0,
   anon_v5_select:0,anon_v5_rpc:0}));
  assert.match(run('metadata',[dir,'before',target]),/"status":"PASS"/);
  const after={v4_core_rls:8,v5_tables:27,v5_rls:27,
   anon_v5_select:0,anon_v5_rpc:0};
  writeFileSync(target,JSON.stringify(after));
  assert.match(run('metadata',[dir,'after',target]),/"status":"PASS"/);
  writeFileSync(target,JSON.stringify({...after,anon_v5_rpc:1}));
  assert.throws(()=>run('metadata',[dir,'after',target]));
  writeFileSync(target,JSON.stringify({...after,v5_rls:26}));
  assert.throws(()=>run('metadata',[dir,'after',target]));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the production SQL metadata inspector is SELECT-only',()=>{
 const sql=readFileSync(new URL('../scripts/release/v5-production-metadata-readonly.sql',import.meta.url),'utf8');
 assert.match(sql,/select jsonb_build_object\(/i);
 const code=sql.replace(/--[^\n]*/g,'');
 assert.doesNotMatch(code,/\b(?:create|alter|drop|insert|update|delete|grant|revoke|truncate|copy)\b/i);
});


test('Alpha gate cannot reclassify unfinished commercial checks as PASS',()=>{
 const a=JSON.parse(readFileSync(new URL(
  '../docs/v5/V5_PRODUCTION_ALPHA_APPROVAL_20261112.json',import.meta.url),'utf8'));
 assert.equal(a.status,'ALPHA_GO');
 assert.equal(a.scope,'INTERNAL_PRODUCTION_ALPHA_NO_PLATFORM_CHARGES');
 assert.equal(a.original_commercial_approval,'BLOCKED');
 assert.equal(a.source_lock_approved_release,'NO_GO');
 assert.equal(a.production_project_ref,'vctisuglfoxyuwlvyjee');
 assert.equal(a.release_sha,'97ed121f68d3ffed40770d2c7141ec1c15b6f574');
 assert.equal(a.base_migrations,43);
 assert.equal(a.forward_migrations,19);
 assert.equal(a.expected_migrations,62);
 for(const enabled of Object.values(a.restrictions)) assert.equal(enabled,true);
 for(const key of [
  'release_ci','production_43_history_and_cli_preflight',
  'current_v4_rls_anonymous_baseline','production_vercel_project_sha',
  'internal_accounting_code_and_jwt_tests',
  'repository_sql_no_external_payment_or_mail_calls'
 ]) assert.equal(a.evidence[key],'PASS');
 assert.equal(a.evidence.independent_gas_and_provider_operations,'PARTIAL');
 assert.equal(a.evidence.full_production_database_restore,'NOT_TESTED');
 assert.equal(a.evidence.production_three_role_team_gui,'NOT_TESTED');
 assert.equal(a.evidence.commercial_bank_reconciliation,'NOT_APPLICABLE');
 assert.equal(a.authorization.authorized_by,'product_owner');
});

test('Alpha apply keeps commercial GO independent and requires protected environment',()=>{
 const workflow=readFileSync(new URL(
  '../.github/workflows/v5-production-migration.yml',import.meta.url),'utf8');
 const guardSource=readFileSync(guard,'utf8');
 assert.match(workflow,/options: \[preflight, apply, alpha-apply\]/);
 assert.match(workflow,/environment: v5-production-db/);
 assert.match(workflow,/github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/alpha-approve/);
 assert.match(workflow,/if: inputs\.operation == 'apply' \|\| inputs\.operation == 'alpha-apply'/g);
 assert.match(workflow,/V5_WRITE_ENABLED: 'GO'/);
 assert.match(guardSource,/function approveAlpha\(\)/);
 assert.match(guardSource,/alpha\.status,'ALPHA_GO'/);
 assert.match(guardSource,/a\.status,'BLOCKED'/);
 assert.match(guardSource,/process\.env\.V5_OPERATION,'alpha-apply'/);
 assert.match(guardSource,/process\.env\.V5_WRITE_ENABLED,'GO'/);
 assert.match(guardSource,/ALPHA_APPLY_V5_19_/);
 assert.match(guardSource,/else if\(cmd==='approve'\)approve\(\)/);
 assert.match(guardSource,/else if\(cmd==='alpha-approve'\)approveAlpha\(\)/);
});
