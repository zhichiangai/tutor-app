// Explain V4 function fingerprint drift without copying any function bodies,
// auth information, business rows, passwords or hosted project credentials.
// This diagnostic is local-to-CI ONLY; its output is not a Production GO signal.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const root=new URL('../../',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL(
 'docs/v5/catalog/PRODUCTION_V4_43_FUNCTION_COMPONENTS_20261108.json',root),'utf8'));
const sql=readFileSync(new URL('tests/sql/v5_function_components_readonly.sql',root),'utf8');
assert.equal(process.env.CI,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.equal(baseline.source,'production_43_history_function_components');
assert.equal(baseline.functions.length,54,'Expected 54 V4 functions in Production baseline');
const stripped=sql.replace(/--[^\n]*/g,'');
assert.ok(!/\b(?:create|alter|drop|truncate|insert|update|delete|grant|revoke|execute)\b/i.test(stripped),
 'Function component query must be SELECT-only');
const output=execFileSync('docker',[
 'exec','supabase_db_tutor_v4_isolated','psql',
 '-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',sql
],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:35000,maxBuffer:2*1024*1024}).trim();
const current=JSON.parse(output);
assert.equal(current.source,'function_component_fingerprint');
assert.ok(Array.isArray(current.functions),'Missing current component fingerprint');
const right=new Map(current.functions.map(x=>[x.id,x]));
const kinds=['body','mode','path','grants'];
const changed=[],missing=[],breakdown=Object.fromEntries(kinds.map(x=>[x,0]));
for(const original of baseline.functions){
 const actual=right.get(original.id);
 if(!actual){missing.push(original.id);continue;}
 const causes=kinds.filter(kind=>actual[kind+'_h']!==original[kind+'_h']);
 for(const cause of causes)breakdown[cause]++;
 if(causes.length)changed.push({id:original.id,causes});
}
const left=new Set(baseline.functions.map(x=>x.id));
const added=current.functions.map(x=>x.id).filter(id=>!left.has(id));
const drift=changed.length+missing.length;
const result={
 status:drift?'PARTIAL_FUNCTION_DRIFT':'MATCHED',
 comparison:'production_43_history_v4_vs_disposable_clean_v4_v5',
 source:'metadata_hashes_only',production_writes:0,
 baseline_functions:baseline.functions.length,
 disposable_functions:current.functions.length,
 changed_functions:changed,
 changed_count:changed.length,
 missing_functions:missing,
 added_count:added.length,
 categories:breakdown,
 release_gate:drift?'NO_GO_until_function_drift_reviewed':'METADATA_MATCH_ONLY_NOT_SCHEMA_REPLAY',
 real_43_history_schema_rehearsal:false
};
console.log(JSON.stringify(result));
if(drift)console.warn('::warning::Production-to-disposable V4 function metadata drift requires manual review; no Production schema replay is claimed');
if(drift&&process.env.V5_SCHEMA_DRIFT_STRICT==='1')process.exitCode=1;
