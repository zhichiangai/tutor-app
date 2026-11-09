// V5.6 new eleven-file *source* lock: historical nine/ten manifest stays frozen.
// Offline only. Source parity != authentic Production 43-history compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const prior=json('docs/v5/catalog/V5_A1_TEN_MIGRATION_SOURCE_LOCK_20261109.json');
const current=json('docs/v5/catalog/V5_A1_ELEVEN_MIGRATION_SOURCE_LOCK_20261109.json');
const dir=new URL('supabase/migrations/',root);
const names=readdirSync(dir)
 .filter(x=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(x)).sort();

test('V5.6 source-only evidence is exactly eleven files; Production NO-GO',()=>{
 assert.equal(prior.migration_files.length,10);
 assert.equal(current.migration_files.length,11);
 assert.equal(current.verification,'git_blob_sha1_exact_bytes');
 assert.equal(current.approved_release,'NO_GO');
 assert.deepEqual(current.migration_files.slice(0,10),prior.migration_files);
 for(const [gate,ok] of Object.entries(current.gate))
  assert.equal(ok,false,'No unproven release gate may claim PASS: '+gate);
 assert.equal(current.gate.real_43_history_schema_replay_verified,false);
 const actual=current.migration_files.map(x=>x.path.split('/').at(-1));
 assert.deepEqual(actual,names.slice(0,11),'Historical eleven-file source lock must remain untouched');
 assert.deepEqual(names.slice(11,12),['20261110032000_v5_6_team_allocated_refund_intake.sql'],'Twelfth migration requires separate source lock');
 assert.equal(actual.at(-1),'20261109163000_v5_6_team_refund_correction_ledger.sql');
 assert.equal(new Set(current.migration_files.map(x=>x.version)).size,11);
});

test('Each of eleven reviewed source files matches Git blob SHA-1 and exact bytes',()=>{
 for(const item of current.migration_files){
  const raw=readFileSync(new URL(item.path,root));
  const blob=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  assert.equal(raw.length,item.bytes,item.path+' byte drift');
  assert.equal(blob,item.git_blob_sha1,item.path+' content drift');
  assert.equal(item.version,item.path.split('/').at(-1).slice(0,14));
 }
});

test('V5.6 prototype remains behind cost/isolation, refund and Production gates',()=>{
 const gate=readFileSync(new URL('docs/v5/V5_6_A1_R3_EXECUTION_GATE_20261109.md',root),'utf8');
 assert.match(gate,/NO-GO/);
 assert.match(gate,/43-history/);
 assert.match(gate,/BLOCKED/);
 assert.match(gate,/更正/);
 assert.match(gate,/退款/);
 assert.match(gate,/未授權/);
});
