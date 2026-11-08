// Check V4 catalog parity after restoring Production-like service_role grants
// on disposable CI only. This is NOT a real 43-history schema replay.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
assert.equal(process.env.CI,'true','CI only');
assert.equal(process.env.V4_E2E_LOCAL,'1','Disposable CI only');
assert.match(read('supabase/config.toml'),/^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(new URL('supabase/.temp/project-ref',root)),false,'Hosted link not allowed');
// Supabase local startup may create .branches/_current_branch; it is NOT a hosted link.
const baseline=JSON.parse(read('docs/v5/catalog/PRODUCTION_V4_43_FUNCTION_COMPONENTS_20261108.json'));
const fullBaseline=JSON.parse(read('docs/v5/catalog/PRODUCTION_V4_43_SCHEMA_FINGERPRINT_20261108.json'));
const componentSQL=read('tests/sql/v5_function_components_readonly.sql');
const fullSQL=read('tests/sql/v5_production_schema_fingerprint_readonly.sql');
assert.equal(baseline.source,'production_43_history_function_components');
assert.equal(baseline.functions.length,54);
assert.equal(fullBaseline.source,'production_catalog_metadata_only');
assert.equal(fullBaseline.tables.length,35);
function sanitize(sql){return sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");}
for(const sql of [componentSQL,fullSQL])
 assert.ok(!/\b(?:create|alter|drop|truncate|insert|update|delete|grant|revoke|execute)\b/i.test(sanitize(sql)),
  'Metadata SQL is not SELECT-only');
const args=['exec','supabase_db_tutor_v4_isolated','psql',
 '-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'];
function db(sql){
 return execFileSync('docker',[...args,'-c',sql],{
  encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,
  stdio:['ignore','pipe','pipe']
 }).trim();
}
const query=sql=>JSON.parse(db(sql));
const current=query(componentSQL);
assert.equal(current.source,'function_component_fingerprint');
const actualById=new Map(current.functions.map(x=>[x.id,x]));
assert.equal(actualById.size,current.functions.length);
const triads=new Map();
for(const anon of [false,true])for(const authenticated of [false,true])
 for(const service_role of [false,true]){
  const hash=createHash('md5').update('['+[anon,authenticated,service_role].join(', ')+']').digest('hex');
  triads.set(hash,{anon,authenticated,service_role});
 }
function grants(hash){const flags=triads.get(hash);assert.ok(flags,'Unknown role flags');return flags;}
const overlay=[];
for(const wanted of baseline.functions){
 const actual=actualById.get(wanted.id);
 assert.ok(actual,'Missing baseline function '+wanted.id);
 for(const kind of ['body','mode','path'])
  assert.equal(actual[kind+'_h'],wanted[kind+'_h'],'Unexpected function '+kind+' drift '+wanted.id);
 if(actual.grants_h===wanted.grants_h)continue;
 const prod=grants(wanted.grants_h),local=grants(actual.grants_h);
 assert.equal(prod.anon,local.anon,'anon grant differs '+wanted.id);
 assert.equal(prod.authenticated,local.authenticated,'authenticated grant differs '+wanted.id);
 assert.equal(prod.service_role,true,'Unexpected Production grant');
 assert.equal(local.service_role,false,'Unexpected disposable grant');
 assert.match(wanted.id,/^(?:public|tutor_private)\.[a-z][a-z0-9_]*\([a-z0-9_ ,.\[\]]*\)$/i);
 overlay.push(wanted.id);
}
assert.equal(overlay.length,27,'Unexpected number of service_role grant deltas');

// Exact OID matching before executing 27 GRANTs, all inside disposable CI.
// Only the existing V4 function set is modified, not V5, table ACLs or RLS.
const values=overlay.map(id=>"('"+id.replaceAll("'","''")+"')").join(',\n');
const join='FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace '+
 'JOIN (VALUES '+values+') AS wanted(id) '+
 "ON wanted.id=n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'";
const overlaySQL=[
 'BEGIN;',
 'DO $local_only$',
 'DECLARE number_found integer; signature text;',
 'BEGIN',
 ' SELECT count(*) INTO number_found '+join+';',
 " IF number_found <> 27 THEN RAISE EXCEPTION 'Expected exactly 27 V4 RPCs, got %',number_found; END IF;",
 ' FOR signature IN SELECT (p.oid::regprocedure)::text '+join,
 ' LOOP',
 "  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',signature);",
 ' END LOOP;',
 'END $local_only$;',
 'COMMIT;'
].join('\n');
db(overlaySQL);

const after=query(componentSQL);
const afterById=new Map(after.functions.map(x=>[x.id,x]));
for(const wanted of baseline.functions){
 const actual=afterById.get(wanted.id);
 assert.ok(actual,'Missing function after grant overlay '+wanted.id);
 for(const kind of ['body','mode','path','grants'])
  assert.equal(actual[kind+'_h'],wanted[kind+'_h'],'Still drifting '+kind+' '+wanted.id);
}
const full=query(fullSQL);
const summary={};
for(const section of ['tables','columns','constraints','indexes','policies','triggers','functions']){
 const left=new Map(fullBaseline[section].map(x=>[x.id,x.h]));
 const right=new Map(full[section].map(x=>[x.id,x.h]));
 const missing=[...left.keys()].filter(id=>!right.has(id));
 const changed=[...left.keys()].filter(id=>right.has(id)&&right.get(id)!==left.get(id));
 assert.deepEqual(missing,[],'Missing V4 baseline objects: '+section);
 assert.deepEqual(changed,[],'Altered V4 baseline objects: '+section);
 summary[section]={baseline:left.size,disposable:right.size,added:right.size-left.size};
}
assert.equal(summary.tables.added,27,'Unexpected V5 table additions');
console.log(JSON.stringify({
 status:'PASS_V4_METADATA_PARITY_WITH_LOCAL_GRANT_OVERLAY',
 environment:'disposable_local_CI',
 original_service_role_grant_drift:overlay.length,
 baseline_v4_functions:baseline.functions.length,
 all_seven_catalog_sections_match:true,sections:summary,
 production_writes:0,actual_43_history_schema_replay_verified:false,
 release_gate:'NO_GO_until_real_43_history_replay'
}));