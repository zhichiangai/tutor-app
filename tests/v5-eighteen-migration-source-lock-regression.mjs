import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const file=n=>'docs/v5/catalog/V5_A1_'+n+'_MIGRATION_SOURCE_LOCK_20261110.json';
const load=n=>JSON.parse(readFileSync(new URL(file(n),root),'utf8'));
const prev=load('SEVENTEEN'),latest=load('EIGHTEEN');
test('Eighteenth migration source lock extends exact previous frozen source, remains NO-GO',()=>{
 assert.equal(prev.migration_files.length,17);
 assert.equal(latest.migration_files.length,18);
 assert.deepEqual(latest.migration_files.slice(0,17),prev.migration_files);
 assert.equal(latest.approved_release,'NO_GO');
 for(const [key,v]of Object.entries(latest.gate))
  assert.equal(v,false,'Never promote unverified gate: '+key);
 const names=readdirSync(new URL('supabase/migrations/',root))
  .filter(x=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(x)).sort();
 assert.deepEqual(names.slice(0,18),latest.migration_files.map(x=>x.path.split('/').at(-1)));
});
test('All 18 source hash/byte locks reflect actual reviewed SQL',()=>{
 for(const x of latest.migration_files){
  const buf=readFileSync(new URL(x.path,root));
  assert.equal(buf.length,x.bytes,x.path);
  assert.equal(createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex'),
   x.git_blob_sha1,x.path);
 }
});