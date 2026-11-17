#!/usr/bin/env node
// Compare two scalar-only database inventories from Production and an isolated
// restore. NEVER executes SQL or handles pg_dump, credentials, or data rows.
// Parity is a necessary condition, not a completed backup/restore attestation.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,sep} from 'node:path';

const repo=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
function load(p){
 assert.ok(isAbsolute(p),'Private inventory path must be absolute');
 const absolute=realpathSync(resolve(p));
 const rel=relative(repo,absolute);
 assert.ok(rel==='..'||rel.startsWith('..'+sep),'Do not use inventories inside the source repository');
 const st=lstatSync(absolute);
 assert.ok(st.isFile()&&!st.isSymbolicLink(),'Inventories must be private regular files');
 assert.equal(st.mode&0o077,0,'Inventory permissions must be owner-only');
 const obj=JSON.parse(readFileSync(absolute,'utf8'));
 assert.equal(obj.purpose,'V58_RESTORE_PARITY_REFERENCE_NOT_BACKUP');
 assert.equal(obj.source_project_ref,'vctisuglfoxyuwlvyjee');
 assert.equal(obj.production_writes,0);
 assert.ok(obj.migration_count===62,'Expected baseline of 62 migrations');
 assert.equal(obj.latest_version,'20261110100000');
 assert.match(obj.parent_rpc_md5,/^[0-9a-f]{32}$/);
 assert.equal(obj.rpc_security_definer,true);
 assert.equal(obj.rpc_stable,true);
 assert.equal(obj.rpc_anon_executable,false);
 assert.equal(obj.rpc_authenticated_executable,true);
 assert.ok(obj.counts&&typeof obj.counts==='object'&&!Array.isArray(obj.counts));
 assert.ok(Object.keys(obj.counts).length>=15,'Inventory must cover business/Auth/Storage counts');
 for(const value of Object.values(obj.counts)){
  assert.ok(Number.isSafeInteger(value)&&value>=0,'Only scalar nonnegative table counts allowed');
 }
 for(const key of ['rls_table_count','non_rls_table_count']){
  assert.ok(Number.isSafeInteger(obj[key])&&obj[key]>=0);
 }
 return obj;
}
export function compareInventories(source,restored){
 const keys=['migration_count','latest_version','parent_rpc_md5',
 'rpc_security_definer','rpc_stable','rpc_anon_executable',
 'rpc_authenticated_executable','rls_table_count','non_rls_table_count'];
 const mismatches=[];
 for(const key of keys)if(source[key]!==restored[key])mismatches.push(key);
 const a=Object.keys(source.counts).sort(),b=Object.keys(restored.counts).sort();
 if(JSON.stringify(a)!==JSON.stringify(b))mismatches.push('count_table_keys');
 else for(const k of a)if(source.counts[k]!==restored.counts[k])
  mismatches.push('counts.'+k);
 return mismatches;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  assert.equal(process.argv.length,4,'Usage: node v58-private-restore-parity.mjs SOURCE_JSON RESTORED_JSON');
  assert.ok(!process.env.CI&&!process.env.GITHUB_ACTIONS,'Refuse any real metadata workflow in CI');
  const source=load(process.argv[2]),restored=load(process.argv[3]);
  const mismatches=compareInventories(source,restored);
  if(mismatches.length){
   // Do not echo actual database counts or other details, only field names.
   process.stderr.write('NO_GO: isolated restore differs in '+mismatches.join(', ')+'\n');
   process.exitCode=1;
  }else {
   process.stdout.write(JSON.stringify({
    status:'SCALAR_RESTORE_PARITY_PASS_FULL_RESTORE_NOT_VERIFIED',
    migration_count:62,table_types:Object.keys(source.counts).length,
    raw_rows_printed:0,backup_restore_complete:false
   })+'\n');
  }
 }catch{
  process.stderr.write('NO_GO: private restore inventories missing or invalid\n');
  process.exitCode=2;
 }
}
