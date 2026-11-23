#!/usr/bin/env node
// Write a short-lived libpq passfile for an approved isolated Actions runner.
// Never print the credential; never use PGPASSWORD or a password URL.
import assert from 'node:assert/strict';
import {writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export function createPrivatePgpass({target,runnerDir,host,port,user,password}){
  assert.ok(isAbsolute(target)&&isAbsolute(runnerDir),'Absolute paths required');
  const root=realpathSync(runnerDir),parent=realpathSync(dirname(target));
  const rel=relative(root,parent);
  assert.ok(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)),
    'PGPASSFILE outside dedicated private runner directory');
  assert.equal(lstatSync(parent).mode&0o077,0,'PGPASSFILE parent must be owner-only');
  assert.equal(host,'db.vctisuglfoxyuwlvyjee.supabase.co');
  assert.equal(port,'5432');
  assert.equal(user,'postgres');
  assert.ok(typeof password==='string'&&password.length>=12&&password.length<=1024,
    'Credential missing');
  assert.ok(!/[\r\n\0]/.test(password),'Unsafe multiline credential');
  const esc=x=>x.replace(/\\/g,'\\\\').replace(/:/g,'\\:');
  const line=[host,port,'postgres',user,esc(password)].join(':')+'\n';
  writeFileSync(target,line,{flag:'wx',mode:0o600});
  assert.equal(lstatSync(target).mode&0o077,0);
  return {status:'PGPASSFILE_CREATED_OWNER_ONLY',credentials_emitted:0};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert.equal(process.argv.length,2);
    assert.equal(process.env.GITHUB_ACTIONS,'true');
    assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
    assert.equal(process.env.GITHUB_REF,'refs/heads/main');
    assert.ok(process.env.V58_SECRET_DB_PASSWORD,'Missing protected DB secret');
    const result=createPrivatePgpass({
      target:process.env.PGPASSFILE,
      runnerDir:process.env.V58_RUN_PRIVATE_DIR,
      host:process.env.PGHOST,
      port:process.env.PGPORT,
      user:process.env.PGUSER,
      password:process.env.V58_SECRET_DB_PASSWORD
    });
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('NO_GO: protected PG17 credential setup failed\n');
    process.exitCode=2;
  }
}
