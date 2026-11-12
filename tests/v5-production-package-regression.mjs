import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const source=new URL('../scripts/release/package-v5-43-plus-19.mjs',import.meta.url);
function run(...args){
 return JSON.parse(execFileSync(process.execPath,[source.pathname,...args],
  {encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
}
test('V5 package verifies immutable 43 historical and 19 forward SQL without cloud access',()=>{
 const data=run('check');
 assert.equal(data.result,'PASS');
 assert.equal(data.existing_history,43);
 assert.equal(data.pending_v5,19);
 assert.equal(data.total,62);
 assert.equal(data.production_writes,0);
 assert.equal(data.remote_connections,0);
 assert.equal(data.source_lock_release,'NO_GO');
 assert.equal(data.package_created,false);
});
test('V5 package creates 62 accurate files in temporary external location only',()=>{
 const parent=mkdtempSync(join(tmpdir(),'tutor-v5-release-'));
 const output=join(parent,'review-package');
 try{
  const data=run('package',output);
  assert.equal(data.package_created,true);
  const files=readdirSync(join(output,'supabase','migrations')).sort();
  assert.equal(files.length,62);
  assert.equal(new Set(files.map(x=>x.slice(0,14))).size,62);
  assert.equal(files[0].slice(0,14),data.first);
  assert.equal(files.at(-1).slice(0,14),data.last);
  assert.match(readFileSync(join(output,'RELEASE_PACKAGE_README.txt'),'utf8'),/NOT Production authorization/);
  assert.ok(existsSync(join(output,'supabase','migrations',files[0])));
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('V5 package rejects package output inside source repository or implicit overwrite',()=>{
 assert.throws(()=>execFileSync(process.execPath,[source.pathname,'package',process.cwd()],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}));
});
