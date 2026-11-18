#!/usr/bin/env node
// Synthetic-only TOC entry selector. It never executes SQL, writes a database,
// reads credentials or interprets archived user data.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const EXPECTED=new Set([
 'auth.users','auth.identities','auth.sessions','auth.refresh_tokens',
 'supabase_migrations.schema_migrations'
]);
export function selectManagedDataOnly(toc){
 assert.ok(typeof toc==='string'&&toc.length>0);
 const selected=[],seen=new Set();
 const lines=toc.split(/\r?\n/);
 for(const line of lines){
  if(!line.trim()||line.startsWith(';'))continue;
  const match=/^\d+;\s+\d+\s+\d+\s+TABLE DATA\s+(auth|supabase_migrations)\s+([^\s]+)\s+/.exec(line);
  if(!match)continue;
  const name=match[1]+'.'+match[2];
  if(!EXPECTED.has(name))continue;
  if(seen.has(name))throw Error('Duplicate table in managed-data TOC');
  selected.push(line);seen.add(name);
 }
 for(const name of EXPECTED)if(!seen.has(name))throw Error('Missing expected managed table: '+name);
 const output=lines.filter(x=>!x.trim()||x.startsWith(';')||selected.includes(x)).join('\n')+'\n';
 assert.equal(selected.length,EXPECTED.size);
 return {list:output,tableCount:selected.length,scope:'SYNTHETIC_LOCAL_MANAGED_DATA_ONLY',
  roleSqlIncluded:false,schemaDdlIncluded:false,storageObjectsIncluded:false,
  productionDataIncluded:false,fullRestoreVerified:false};
}
if(process.argv[1]?.endsWith('v58-managed-state-data-list.mjs')){
 try{
  assert.equal(process.argv.length,4,'Usage: node tool.mjs SOURCE_TOC OUTPUT_LIST');
  assert.equal(process.env.CI,'true');
  assert.equal(process.env.V58_MANAGED_STATE_LOCAL,'1');
  const p=selectManagedDataOnly(readFileSync(process.argv[2],'utf8'));
  writeFileSync(process.argv[3],p.list,{flag:'wx',mode:0o600});
  console.log('PASS: exact five synthetic managed-data table entries selected; no schema/role DDL');
 }catch{
  console.error('NO_GO: managed synthetic table list unavailable or unreviewed');
  process.exitCode=2;
 }
}
