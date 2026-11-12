#!/usr/bin/env node
// Offline source-only release packager. It never links to or writes a hosted DB.
// Operator must independently confirm the eventual Production dry-run and release gate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname,resolve,isAbsolute,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const command=process.argv[2]??'check';
assert.ok(['check','package'].includes(command),'Only check or package are supported');
assert.equal(process.argv.length,command==='check'?3:4,'Unexpected arguments');
const read=path=>readFileSync(join(root,path));
const history=JSON.parse(read('docs/v5/catalog/PRODUCTION_V4_43_HISTORY_SOURCE_MAP_20261110.json'));
const lock=JSON.parse(read('docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json'));
const fixes=JSON.parse(read('tests/a1r3/v26-production-history-sql.json'));
assert.equal(history.expected_history_count,43);
assert.equal(history.entries.length,43);
assert.equal(lock.migration_files.length,19);
assert.equal(lock.approved_release,'NO_GO','Packaging must not silently authorize Production');
assert.equal(fixes.production_writes,0);
const md5=buf=>createHash('md5').update(buf.toString('utf8').trim()).digest('hex');
const blobHash=buf=>createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
const output=[];
for(const entry of history.entries){
 assert.match(entry.version,/^[0-9]{14}$/);
 assert.match(entry.name,/^[a-z0-9_]+$/);
 let bytes;
 if(entry.kind==='repo_sql'||entry.kind==='existing_candidate'){
  assert.match(entry.path,/^(supabase\/migrations|supabase\/candidates)\/[a-zA-Z0-9_.-]+\.sql$/);
  bytes=read(entry.path);
 }else if(entry.kind==='historical_policy_snapshot'){
  const original=fixes.versions[entry.version]?.sql;
  assert.equal(typeof original,'string','Missing safe historical SQL');
  bytes=Buffer.from(original);
 }else throw Error('Unknown historical SQL source: '+entry.version);
 assert.equal(md5(bytes),entry.canonical_md5,'History SQL checksum changed: '+entry.version);
 output.push({name:entry.version+'_'+entry.name+'.sql',bytes,kind:'history'});
}
for(const entry of lock.migration_files){
 assert.match(entry.path,/^supabase\/migrations\/[0-9]{14}_[a-z0-9_]+\.sql$/);
 const bytes=read(entry.path);
 assert.equal(bytes.length,entry.bytes,'Forward SQL length mismatch: '+entry.version);
 assert.equal(blobHash(bytes),entry.git_blob_sha1,'Forward SQL blob changed: '+entry.version);
 assert.equal(basename(entry.path).slice(0,14),entry.version);
 assert.ok(entry.version>history.production_last_version,'Older forward migration refused');
 output.push({name:basename(entry.path),bytes,kind:'forward'});
}
const versions=output.map(x=>x.name.slice(0,14));
assert.equal(output.length,62);
assert.equal(new Set(versions).size,62);
assert.deepEqual(versions,[...versions].sort(),'Migration ordering drift');
if(command==='package'){
 const target=process.argv[3];
 assert.ok(isAbsolute(target),'Package target must be an absolute path');
 const outputDir=resolve(target),rootDir=resolve(root);
 assert.ok(outputDir!==rootDir&&!outputDir.startsWith(rootDir+sep),
  'Never put release package inside repository');
 assert.ok(outputDir!==sep,'Filesystem root is not a package destination');
 assert.equal(existsSync(outputDir),false,'Refuse to overwrite an existing target');
 assert.equal(existsSync(dirname(outputDir)),true,'Parent directory must exist');
 const migrations=join(outputDir,'supabase','migrations');
 mkdirSync(migrations,{recursive:true});
 for(const item of output)writeFileSync(join(migrations,item.name),item.bytes,{flag:'wx',mode:0o600});
 writeFileSync(join(outputDir,'RELEASE_PACKAGE_README.txt'),
  'OFFLINE SOURCE PACKAGE ONLY. 43 authentic V4 history files + 19 source-locked V5 forward SQL. '+
  'The original Source-Lock is NO_GO; this package is NOT Production authorization. '+
  'Check exact remote history, CLI version, target project, dry-run and release gates before any write.\n',
  {flag:'wx',mode:0o600});
}
console.log(JSON.stringify({
 result:'PASS',scope:'offline-source-only',existing_history:43,pending_v5:19,
 total:62,first:versions[0],last:versions.at(-1),
 production_writes:0,remote_connections:0,source_lock_release:lock.approved_release,
 package_created:command==='package'
}));
