// Synthetic-only checks; no Production access, no credentials, no real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/release/v58-private-backup-manifest.mjs',import.meta.url));
const files=['roles.sql','schema.sql','data.sql','auth_data.sql','storage_data.sql','history_schema.sql','history_data.sql'];
const runner=(mode,dir,{ci=false}={})=>{
 const env={...process.env};
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
  assert.equal(runner('verify',dir).status,0);
  assert.notEqual(runner('create',dir).status,0,'must not overwrite previous archive');
  assert.notEqual(runner('verify',dir,{ci:true}).status,0,'real checker must refuse CI');
  writeFileSync(join(dir,'data.sql'),'-- synthetic only: changed data\n',{mode:0o600});
  assert.notEqual(runner('verify',dir).status,0,'tampered SQL must be rejected');
  chmodSync(join(dir,'data.sql'),0o644);
  assert.notEqual(runner('verify',dir).status,0,'group/world-readable SQL must be rejected');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
