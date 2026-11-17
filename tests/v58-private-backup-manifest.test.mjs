// Synthetic-only checks; no Production access, no credentials, no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectDumpTargetFlag} from '../scripts/release/v58-backup-target-flag.mjs';

const script=fileURLToPath(new URL('../scripts/release/v58-private-backup-manifest.mjs',import.meta.url));
const files=['roles.sql','schema.sql','data.sql','auth_data.sql','storage_data.sql','history_schema.sql','history_data.sql'];
const runner=(mode,dir,{ci=false}={})=>{
 const env={...process.env};
 // Fake timestamps and CLI version belong only to the synthetic fixture.
 env.V58_SUPABASE_CLI_VERSION='2.107.0';
 env.V58_BACKUP_STARTED_UTC='2026-11-17T00:00:00Z';
 env.V58_BACKUP_FINISHED_UTC='2026-11-17T00:02:00Z';
 if(ci){env.CI='true';env.GITHUB_ACTIONS='true';}
 else{delete env.CI;delete env.GITHUB_ACTIONS;}
 return spawnSync(process.execPath,[script,mode,dir],{env,encoding:'utf8'});
};

test('private restore manifest detects tampering and refuses any public output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v58-synthetic-private-backup-'));
 try {
  chmodSync(dir,0o700);
  for(const f of files)writeFileSync(join(dir,f),'-- synthetic only: '+f+'\n',{mode:0o600});
  const create=runner('create',dir);
  assert.equal(create.status,0,create.stderr.slice(0,300));
  const c=JSON.parse(create.stdout);
  assert.equal(c.status,'BACKUP_FILES_INTEGRITY_PASS_RESTORE_NOT_TESTED');
  assert.equal(c.sql_contents_emitted,false);
  assert.equal(c.restore_verified,false);
  const manifest=JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8'));
  assert.equal(manifest.sql_files.length,7);
  assert.equal(manifest.project_ref,'vctisuglfoxyuwlvyjee');
  assert.equal(manifest.supabase_cli_version,'2.107.0');
  assert.equal(manifest.backup_started_utc,'2026-11-17T00:00:00Z');
  assert.equal(manifest.backup_completed_utc,'2026-11-17T00:02:00Z');
  assert.equal(runner('verify',dir).status,0);
  assert.notEqual(runner('create',dir).status,0,'must not overwrite previous archive');
  assert.notEqual(runner('verify',dir,{ci:true}).status,0,'real checker must refuse CI');
  writeFileSync(join(dir,'data.sql'),'-- synthetic only: changed data\n',{mode:0o600});
  assert.notEqual(runner('verify',dir).status,0,'tampered SQL must be rejected');
  chmodSync(join(dir,'data.sql'),0o644);
  assert.notEqual(runner('verify',dir).status,0,'group/world-readable SQL must be rejected');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('selects ONLY explicit remote database flags for reviewed v2/v3 CLI',()=>{
 const both='Usage: supabase db dump [flags] --remote --db-url';
 assert.equal(selectDumpTargetFlag('2.107.0',both),'--db-url');
 assert.equal(selectDumpTargetFlag('3.0.0',both),'--remote');
 assert.equal(selectDumpTargetFlag('3.2.1','--remote[=<ref|branch|url>]'),'--remote');
 assert.throws(()=>selectDumpTargetFlag('2.107.0','--remote'),/missing --db-url/);
 assert.throws(()=>selectDumpTargetFlag('3.2.1','--db-url'),/missing --remote/);
 for(const bad of ['1.88.0','4.0.0','latest','3','']) {
  assert.throws(()=>selectDumpTargetFlag(bad,both),'Must reject unreviewed/ambiguous version '+bad);
 }
 const helper=fileURLToPath(new URL('../scripts/release/v58-backup-target-flag.mjs',import.meta.url));
 const v2=spawnSync(process.execPath,[helper,'2.107.0'],{input:both,encoding:'utf8'});
 assert.equal(v2.status,0);
 assert.equal(v2.stdout.trim(),'--db-url');
 const v3=spawnSync(process.execPath,[helper,'3.0.0'],{input:both,encoding:'utf8'});
 assert.equal(v3.status,0);
 assert.equal(v3.stdout.trim(),'--remote');
 const v4=spawnSync(process.execPath,[helper,'4.0.0'],{input:both,encoding:'utf8'});
 assert.notEqual(v4.status,0);
 assert.equal(v4.stdout,'');
 assert.doesNotMatch(v4.stderr,/postgres:\/\//,'No credentials or target in CLI errors');
});
