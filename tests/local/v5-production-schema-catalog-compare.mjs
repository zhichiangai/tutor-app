// Compare Production's approved, PII-free V4 schema catalog against
// the *disposable local* replay after V4 candidates and V5 migrations.
// This DOES NOT restore real Production data or prove 43-version equivalence.
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
if(process.env.CI!=='true'||process.env.V4_E2E_LOCAL!=='1'){
 throw Error('V5 schema catalog comparison must use disposable CI only');
}
const config=readFileSync(new URL('supabase/config.toml',root),'utf8');
assert.match(config,/^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(new URL('supabase/.temp/project-ref',root)),false,
 'Never run schema comparison on a linked hosted project');
const expected=JSON.parse(readFileSync(new URL(
 'docs/v5/V5_PRODUCTION_V4_SCHEMA_CATALOG_20261106.json',root),'utf8'));
assert.equal(expected.source_project_ref,'vctisuglfoxyuwlvyjee');
assert.equal(expected.observed_production_migration_count,43);
const sql=readFileSync(new URL(
 'supabase/diagnostics/v5_production_schema_catalog_readonly.sql',root),'utf8');
const out=execFileSync('docker',[
 'exec','-i','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'
],{input:sql,encoding:'utf8',maxBuffer:3*1024*1024}).trim();
const actual=JSON.parse(out);
assert.equal(Array.isArray(actual),true,'Expected one SQL JSON array');
const knownNames=names=>(names||[]).filter(n=>!n.startsWith('v5_')&&!n.startsWith('zz_v5_'));
const failures=[];
const parity=[];
for(const target of expected.tables){
 const candidate=actual.find(x=>x.table===target.table);
 if(!candidate||!candidate.exists||!target.exists){
  failures.push(target.table+': required V4 table missing');continue;
 }
 const categories=[
  ['rls',candidate.rls,target.rls],
  ['columns',candidate.columns,target.columns],
  ['legacy constraints',candidate.constraint_names,target.constraint_names],
  ['legacy policies',knownNames(candidate.policy_names),knownNames(target.policy_names)],
  ['legacy triggers',knownNames(candidate.trigger_names),knownNames(target.trigger_names)]
 ];
 for(const [name,got,wanted] of categories){
  try{assert.deepStrictEqual(got,wanted);}
  catch{
   const diff=Array.isArray(got)&&Array.isArray(wanted)?
    ' local='+JSON.stringify(got).slice(0,180)+
    ' prod='+JSON.stringify(wanted).slice(0,180):
    ' local='+JSON.stringify(got)+' prod='+JSON.stringify(wanted);
   failures.push(target.table+' '+name+' differs:'+diff);
  }
 }
 parity.push({table:target.table,columns:candidate.columns.length,rls:candidate.rls});
}
console.log('V5 structural comparison: Production snapshot (43 migration IDs) vs disposable local V4/V5 replay');
console.log(JSON.stringify({tablesCompared:parity.length,productionSnapshotDate:expected.snapshot_date,
 mismatches:failures.length,notes:'No production data copied; not a backup/restore test.'}));
if(failures.length){
 for(const failure of failures)console.error('SCHEMA_DRIFT '+failure);
 console.error('NO-GO: do not infer Production compatibility from green synthetic CI.');
 process.exitCode=1;
}else{
 console.log('STRUCTURAL_SUBSET_PASS: all seven legacy V4 table shapes match after filtering additive V5 names.');
 console.log('Still requires real Production restore, auth roles, actual RLS behavior and data invariants.');
}
