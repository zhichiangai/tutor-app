// Synthetic-only offline restore-inventory validation; no real database or PII.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compareInventories} from '../scripts/release/v58-private-restore-parity.mjs';

const script=fileURLToPath(new URL('../scripts/release/v58-private-restore-parity.mjs',import.meta.url));
const keys=['auth_users','workspaces','students','guardian_links',
 'payment_batches','payment_corrections','teams','team_projects',
 'team_students','team_lessons','team_lesson_fees','team_payment_reports',
 'team_payment_allocations','team_advance_credits','team_refund_requests',
 'family_bridge_acceptances','family_bridge_revocations',
 'storage_buckets','storage_objects','vault_secrets'];
const base={
 purpose:'V58_RESTORE_PARITY_REFERENCE_NOT_BACKUP',
 source_project_ref:'vctisuglfoxyuwlvyjee',
 sample_time_utc:'2026-11-17T00:00:00',database_bytes:123456,
 migration_count:62,latest_version:'20261110100000',
 parent_rpc_md5:'3569963e9d47af5d5e2acc728ccc8f17',
 rpc_security_definer:true,rpc_stable:true,rpc_anon_executable:false,
 rpc_authenticated_executable:true,rls_table_count:71,
 non_rls_table_count:5,counts:Object.fromEntries(keys.map((k,i)=>[k,i])),
 production_writes:0
};
function run(source,destination,ci=false){
 const env={...process.env};
 if(ci){env.CI='true';env.GITHUB_ACTIONS='true';}
 else{delete env.CI;delete env.GITHUB_ACTIONS;}
 return spawnSync(process.execPath,[script,source,destination],{env,encoding:'utf8'});
}
test('only scalar isolated-restore parity passes, without asserting full restore',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v58-synthetic-restore-'));
 try{
  chmodSync(dir,0o700);
  const a=join(dir,'source.json'),b=join(dir,'isolated.json');
  const save=(path,obj)=>writeFileSync(path,JSON.stringify(obj),{mode:0o600});
  save(a,base);
  save(b,{...base,sample_time_utc:'2026-11-17T01:00:00',database_bytes:654321});
  assert.deepEqual(compareInventories(base,base),[]);
  const yes=run(a,b);
  assert.equal(yes.status,0,yes.stderr);
  const status=JSON.parse(yes.stdout);
  assert.equal(status.status,'SCALAR_RESTORE_PARITY_PASS_FULL_RESTORE_NOT_VERIFIED');
  assert.equal(status.backup_restore_complete,false);
  assert.equal(status.raw_rows_printed,0);
  assert.notEqual(run(a,b,true).status,0,'Never run private compare in CI outside synthetic suite');
  save(b,{...base,counts:{...base.counts,auth_users:99}});
  const drift=run(a,b);
  assert.equal(drift.status,1);
  assert.match(drift.stderr,/counts.auth_users/);
  assert.doesNotMatch(drift.stderr,/99/,'Do not reveal row counts from restored DB');
  save(b,{...base,migration_count:63});
  assert.notEqual(run(a,b).status,0,'Wrong migration baseline must fail closed');
  chmodSync(b,0o644);
  assert.notEqual(run(a,b).status,0,'Too-open file permissions must fail closed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
