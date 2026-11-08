// Compare the exact pre-V5 Production metadata inventory against a fully
// bootstrapped V4+V5 disposable Postgres. No remote DB connection is made.
// Differences are a release blocker, even when this diagnostic step exits 0.
// This is NOT a substitute for replaying 9 V5 SQL on a 43-history schema clone.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const root=new URL('../../',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL(
 'docs/v5/catalog/PRODUCTION_V4_43_SCHEMA_FINGERPRINT_20261108.json',root),'utf8'));
const sql=readFileSync(new URL('tests/sql/v5_production_schema_fingerprint_readonly.sql',root),'utf8');
assert.equal(process.env.CI,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.equal(baseline.snapshot_schema,1);
assert.equal(baseline.source,'production_catalog_metadata_only');
assert.equal(baseline.tables.length,35,'Expected 35 V4 business tables in verified Production metadata');
assert.ok(!/\b(?:drop|truncate|insert into|update public\.|delete from)\b/i.test(
 sql.replace(/--[^\n]*/g,'')),'SQL catalog query must be read-only');

const output=execFileSync('docker',[
 'exec','supabase_db_tutor_v4_isolated','psql',
 '-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',sql
],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:35000,maxBuffer:2*1024*1024}).trim();
const current=JSON.parse(output);
const keys=['tables','columns','constraints','indexes','policies','triggers','functions'];
const result={status:'PASS',comparison:'production_v4_metadata_vs_clean_v4_v5',
 source_production:'2026-11-08_catalog_only',target:'disposable_local_postgresql',
 production_writes:0, categories:{},release_schema_replay_verified:false};
let totalDeltas=0;
for(const kind of keys){
 assert.ok(Array.isArray(current[kind]),'Missing catalog section: '+kind);
 const left=new Map(baseline[kind].map(x=>[x.id,x]));
 const right=new Map(current[kind].map(x=>[x.id,x]));
 const missing=[],different=[],added=[];
 for(const [key,obj] of left){
  const x=right.get(key);
  if(!x)missing.push(key);
  else if(x.h!==obj.h)different.push(key);
 }
 for(const key of right.keys())if(!left.has(key))added.push(key);
 totalDeltas+=missing.length+different.length;
 result.categories[kind]={
  production:baseline[kind].length,
  disposable:current[kind].length,
  baseline_missing:missing.length,
  baseline_changed:different.length,
  post_v4_additions:added.length,
  missing_ids:missing.slice(0,18),
  changed_ids:different.slice(0,18)
 };
}
if(totalDeltas){
 result.status='PARTIAL_METADATA_DRIFT';
 result.release_gate='NO_GO_until_drift_reviewed';
}
console.log(JSON.stringify(result));
if(totalDeltas&&process.env.V5_SCHEMA_DRIFT_STRICT==='1')
 process.exitCode=1;
