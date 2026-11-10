// Reconstitute the exact 43 Production V4 migration SQL sources in DISPOSABLE CI.
// No hosted connection, no Production rows, no credentials; no SQL execution here.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,mkdirSync,rmSync,cpSync,writeFileSync,copyFileSync,renameSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const phase=process.argv[2];
assert.ok(['baseline','append-v5'].includes(phase),'Only reviewed isolated replay phases allowed');
assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.match(readFileSync(join(root,'supabase/config.toml'),'utf8'),/^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(join(root,'supabase/.temp/project-ref')),false,'Hosted link forbidden');
const runner=process.env.RUNNER_TEMP;
assert.ok(runner&&runner.startsWith('/home/runner/'),'Must run on GitHub-hosted isolated runner');
const backup=join(runner,'a1r3-original-repository-migrations');
const migrations=join(root,'supabase/migrations');
const list=path=>readdirSync(path).filter(name=>/^[0-9]{14}_[a-zA-Z0-9_]+\.sql$/.test(name)).sort();
const manifest=JSON.parse(readFileSync(join(root,'docs/v5/catalog/PRODUCTION_V4_43_HISTORY_SOURCE_MAP_20261110.json'),'utf8'));
const lock=JSON.parse(readFileSync(join(root,'docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json'),'utf8'));
const fixture=JSON.parse(readFileSync(join(root,'tests/a1r3/v26-production-history-sql.json'),'utf8'));
assert.equal(manifest.expected_history_count,43);
assert.equal(manifest.entries.length,43);
assert.equal(manifest.production_last_version,'20261103212647');
assert.equal(lock.migration_files.length,19);
assert.equal(lock.approved_release,'NO_GO');
assert.equal(fixture.production_writes,0);
const historicalNames=manifest.entries.map(row=>row.version+'_'+row.name+'.sql');
assert.equal(new Set(historicalNames).size,43,'Historical duplicate versions');
assert.ok(historicalNames.every(name=>/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(name)));
const forwards=lock.migration_files.map(row=>basename(row.path));
assert.equal(new Set(forwards).size,19,'Forward migration duplicates');
assert.ok(forwards.every(name=>/^[0-9]{14}_[a-z0-9_]+\.sql$/.test(name) && name.slice(0,14)>manifest.production_last_version));
function readHistorical(row,sourceDir) {
 const source=row.kind==='historical_policy_snapshot'
  ?fixture.versions[row.version]?.sql
  :row.kind==='existing_candidate'
    ?readFileSync(join(root,row.path),'utf8'):null;
 const sql=row.kind==='repo_sql'
  ?readFileSync(join(sourceDir,basename(row.path)),'utf8'):source;
 assert.equal(typeof sql,'string','Missing historical source: '+row.version);
 const md5=createHash('md5').update(sql.trim()).digest('hex');
 assert.equal(md5,row.canonical_md5,'Historical Production SQL changed: '+row.version);
 return sql;
}
function assertForwardSource(directory) {
 for(const row of lock.migration_files) {
  const sql=readFileSync(join(directory,basename(row.path)));
  const hash=createHash('sha1').update(Buffer.from('blob '+sql.length+'\0')).update(sql).digest('hex');
  assert.equal(sql.length,row.bytes,'V5 SQL byte drift: '+row.version);
  assert.equal(hash,row.git_blob_sha1,'V5 source-lock drift: '+row.version);
 }
}
if(phase==='baseline'){
 assert.equal(existsSync(backup),false,'CI backup already exists');
 const originals=list(migrations);
 assert.equal(originals.length,56,'Expected frozen V4/V5 56-migration checkout');
 assertForwardSource(migrations);
 cpSync(migrations,backup,{recursive:true,errorOnExist:true,force:false});
 const stage=join(root,'supabase/.a1r3-history-build');
 assert.equal(existsSync(stage),false);
 mkdirSync(stage,{recursive:true});
 for(let i=0;i<manifest.entries.length;i++){
  const row=manifest.entries[i];
  assert.ok(i===0||row.version>manifest.entries[i-1].version,'Not chronological');
  const sql=readHistorical(row,backup);
  writeFileSync(join(stage,historicalNames[i]),sql);
 }
 rmSync(migrations,{recursive:true});
 renameSync(stage,migrations);
 assert.deepEqual(list(migrations),historicalNames.sort(),'43 migration staging mismatch');
 console.log(JSON.stringify({status:'STAGED',phase:'real_production_43_history_source',history:43,v5_pending:19,production_writes:0,pii_rows:0}));
}else{
 assert.equal(existsSync(backup),true,'Missing CI-only original V5 files');
 assert.deepEqual(list(migrations),[...historicalNames].sort(),'43 source history changed');
 assertForwardSource(backup);
 for(const name of forwards)copyFileSync(join(backup,name),join(migrations,name));
 assert.equal(list(migrations).length,62,'43 history + 19 V5 should be present');
 console.log(JSON.stringify({status:'STAGED',phase:'append_19_v5_forward_migrations',historical:43,pending_forward:19,total:62,production_writes:0}));
}
