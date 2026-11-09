// Frozen source evidence only. Real Production 43-history remains NO-GO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const prior=JSON.parse(read('docs/v5/catalog/V5_A1_TWELVE_MIGRATION_SOURCE_LOCK_20261110.json'));
const current=JSON.parse(read('docs/v5/catalog/V5_A1_THIRTEEN_MIGRATION_SOURCE_LOCK_20261110.json'));
test('13th forward SQL is additive, all historical 12 hashes remain frozen, release NO-GO',()=>{
 assert.equal(prior.migration_files.length,12);
 assert.equal(current.migration_files.length,13);
 assert.deepEqual(current.migration_files.slice(0,12),prior.migration_files);
 assert.equal(current.approved_release,'NO_GO');
 assert.equal(current.verification,'git_blob_sha1_exact_bytes');
 for(const [name,value] of Object.entries(current.gate))
  assert.equal(value,false,'Unverified production gate: '+name);
 const files=readdirSync(new URL('supabase/migrations/',root))
  .filter(x=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(x)).sort();
 assert.deepEqual(files,current.migration_files.map(x=>x.path.split('/').at(-1)));
 assert.equal(new Set(current.migration_files.map(x=>x.version)).size,13);
});
test('All 13 forward SQL byte counts and Git blob hashes are exact',()=>{
 for(const x of current.migration_files){
  const b=read(x.path);
  const sha=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
  assert.equal(b.length,x.bytes,x.path+' bytes drift');
  assert.equal(sha,x.git_blob_sha1,x.path+' content drift');
 }
});
test('Source lock does not authorize Production, bank payouts or legacy gross-read-model reliance',()=>{
 assert.equal(current.gate.real_43_history_schema_replay_verified,false);
 assert.equal(current.gate.legacy_gross_read_model_integrated,false);
 assert.equal(current.gate.net_settlement_conservation_verified,false);
 assert.equal(current.gate.production_migration_authorized,false);
});
