// V5.6 14/15/16 incremental source locks, NO Production execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const load=n=>JSON.parse(readFileSync(new URL(
 'docs/v5/catalog/V5_A1_'+n+'_MIGRATION_SOURCE_LOCK_20261110.json',root),'utf8'));
const snaps=['THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN'].map(load);
test('14/15/16 source locks extend previous release candidates without rewriting bytes',()=>{
 for(let i=1;i<snaps.length;i++){
  const a=snaps[i-1],z=snaps[i];
  assert.equal(z.migration_files.length,a.migration_files.length+1);
  assert.deepEqual(z.migration_files.slice(0,-1),a.migration_files);
  assert.equal(z.approved_release,'NO_GO');
  for(const [gate,passed]of Object.entries(z.gate))
   assert.equal(passed,false,'Unverified release gate: '+gate);
 }
 const latest=snaps.at(-1);
 assert.equal(latest.migration_files.length,16);
 const files=readdirSync(new URL('supabase/migrations/',root))
  .filter(x=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(x)).sort();
 assert.deepEqual(latest.migration_files.map(x=>x.path.split('/').at(-1)),files);
 assert.equal(new Set(latest.migration_files.map(x=>x.version)).size,16);
});
test('Exact Git blob SHA and byte count for every immutable V5 migration source',()=>{
 for(const item of snaps.at(-1).migration_files){
  const buf=readFileSync(new URL(item.path,root));
  assert.equal(buf.length,item.bytes,item.path+' byte drift');
  const hash=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
  assert.equal(hash,item.git_blob_sha1,item.path+' SHA drift');
 }
});
test('Production stays NO-GO even when isolated CI passes',()=>{
 const g=snaps.at(-1).gate;
 assert.equal(g.real_43_history_schema_replay_verified,false);
 assert.equal(g.production_migration_authorized,false);
 assert.equal(g.net_settlement_conservation_verified,false);
 assert.equal(g.parent_specific_refund_history_verified,false);
});