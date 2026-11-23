import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,lstatSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPrivatePgpass} from '../scripts/release/v58-cloud-pgpass.mjs';

const fakePassword='FAKE:password\\not-real';
function setup(){
  const runnerDir=mkdtempSync(join(tmpdir(),'v58-guard-'));
  chmodSync(runnerDir,0o700);
  return {runnerDir,target:join(runnerDir,'connection.pgpass'),
    host:'db.vctisuglfoxyuwlvyjee.supabase.co',port:'5432',
    user:'postgres',password:fakePassword};
}
test('single-use 0600 PGPASSFILE with escaped separators but no printed secrets',()=>{
  const p=setup();
  try{
    const result=createPrivatePgpass(p);
    assert.equal(result.credentials_emitted,0);
    assert.doesNotMatch(JSON.stringify(result),/FAKE/);
    assert.equal(lstatSync(p.target).mode&0o077,0);
    assert.equal(readFileSync(p.target,'utf8'),
      'db.vctisuglfoxyuwlvyjee.supabase.co:5432:postgres:postgres:FAKE\\:password\\\\not-real\n');
    assert.throws(()=>createPrivatePgpass(p),/EEXIST/);
  }finally{rmSync(p.runnerDir,{recursive:true,force:true})}
});
test('refuses unsafe target, broad permissions, wrong database and multiline secrets',()=>{
  const cases=[
    p=>({...p,host:'db.attacker.supabase.co'}),
    p=>({...p,port:'6543'}),
    p=>({...p,user:'service_role'}),
    p=>({...p,password:'invalid\npassword'}),
    p=>({...p,password:'too-short'}),
    p=>({...p,target:'/tmp/unsafe.pgpass'})
  ];
  for(const transform of cases){
    const p=setup();
    try{assert.throws(()=>createPrivatePgpass(transform(p)));}
    finally{rmSync(p.runnerDir,{recursive:true,force:true})}
  }
  const p=setup();
  try{
    chmodSync(p.runnerDir,0o755);
    assert.throws(()=>createPrivatePgpass(p),/owner-only/);
  }finally{rmSync(p.runnerDir,{recursive:true,force:true})}
});
