#!/usr/bin/env node
// PRIVATE OPERATOR ONLY. Never reads or prints SQL contents; no DB access.
// A checksum is proof of file integrity, NOT proof of a restorable backup.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const project='vctisuglfoxyuwlvyjee';
const required=[
 'roles.sql','schema.sql','data.sql',
 'auth_data.sql','storage_data.sql',
 'history_schema.sql','history_data.sql'
];
const [mode,target]=process.argv.slice(2);
assert.ok(['create','verify'].includes(mode),'Usage: node v58-private-backup-manifest.mjs create|verify ABS_PRIVATE_DIR');
assert.equal(process.argv.length,4,'Exactly two arguments required');
assert.ok(isAbsolute(target),'Backup directory must be an absolute path');
const dir=realpathSync(resolve(target));
const rel=relative(root,dir);
assert.ok(rel==='..'||rel.startsWith('..'+sep),'Refuse a private data backup inside this Git repository');
assert.ok(!process.env.GITHUB_ACTIONS&&!process.env.CI,
 'Never process real database dumps on public CI or GitHub Actions');
assert.equal((lstatSync(dir).mode & 0o077),0,'Private backup directory must not be accessible by group/others');

function scan(name){
 assert.ok(/^[a-z_]+\.sql$/.test(name),'Unexpected backup filename');
 const p=join(dir,name);
 assert.ok(existsSync(p),'Missing backup file: '+name);
 const s=lstatSync(p);
 assert.ok(s.isFile()&&!s.isSymbolicLink(),'No symbolic links or nonregular files: '+name);
 assert.ok(s.size>0,'Empty backup file: '+name);
 assert.equal(s.mode & 0o077,0,'Backup files must have owner-only permissions: '+name);
 const hash=createHash('sha256').update(readFileSync(p)).digest('hex');
 return {name,bytes:s.size,sha256:hash};
}
const items=required.map(scan);
function assertTimestamp(value){
 assert.match(value,/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/,'Missing UTC backup timestamp');
 assert.ok(!Number.isNaN(Date.parse(value)),'Invalid UTC backup timestamp');
}
const path=join(dir,'manifest.json');
if(mode==='create'){
 assert.ok(!existsSync(path),'Refuse to overwrite prior backup manifest');
 const cli=process.env.V58_SUPABASE_CLI_VERSION||'';
 const started=process.env.V58_BACKUP_STARTED_UTC||'';
 const finished=process.env.V58_BACKUP_FINISHED_UTC||'';
 assert.match(cli,/^[23]\\.[0-9]+\\.[0-9]+(?:[+-][A-Za-z0-9.-]+)?$/,
  'Missing reviewed Supabase CLI version');
 assertTimestamp(started);assertTimestamp(finished);
 assert.ok(Date.parse(finished)>=Date.parse(started),'Backup completion precedes start');
 const out={
  schema_version:1,project_ref:project,
  purpose:'private_logical_backup_integrity_only',
  backup_started_utc:started,backup_completed_utc:finished,
  supabase_cli_version:cli,
  restore_verified:false,production_writes:0,
  sql_files:items
 };
 writeFileSync(path,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:'BACKUP_FILES_INTEGRITY_PASS_RESTORE_NOT_TESTED',
  project_ref:project,file_count:items.length,manifest_file:'manifest.json',
  sql_contents_emitted:false,restore_verified:false}));
}else{
 assert.ok(existsSync(path),'Missing manifest.json');
 assert.equal(lstatSync(path).mode & 0o077,0,'Manifest permissions are too open');
 const original=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(original.schema_version,1);
 assert.equal(original.project_ref,project);
 assertTimestamp(original.backup_started_utc);
 assertTimestamp(original.backup_completed_utc);
 assert.ok(Date.parse(original.backup_completed_utc)>=Date.parse(original.backup_started_utc));
 assert.match(original.supabase_cli_version,/^[23]\\.[0-9]+\\.[0-9]+(?:[+-][A-Za-z0-9.-]+)?$/);
 assert.equal(original.restore_verified,false);
 assert.equal(original.sql_files.length,items.length);
 assert.deepEqual(original.sql_files,items,'Backup checksum or file set differs');
 console.log(JSON.stringify({status:'BACKUP_FILES_INTEGRITY_PASS_RESTORE_NOT_TESTED',
  project_ref:project,file_count:items.length,sql_contents_emitted:false,restore_verified:false}));
}
