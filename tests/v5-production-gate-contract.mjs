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
