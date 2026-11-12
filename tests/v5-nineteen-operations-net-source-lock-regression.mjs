// V5.7 net per-project accounting, immutable 19-source review, Production NO-GO.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const old=JSON.parse(read('docs/v5/catalog/V5_A1_EIGHTEEN_MIGRATION_SOURCE_LOCK_20261110.json'));
const current=JSON.parse(read('docs/v5/catalog/V5_A1_NINETEEN_MIGRATION_SOURCE_LOCK_20261110.json'));
const sql=read('supabase/migrations/20261110100000_v5_7_team_operations_net_reconciliation.sql');
const oldSql=read('supabase/migrations/20261108230000_v57_team_operations_overview.sql');
const ui=read('v2/v5-billing.js');
test('SQL19 is only one new forward source with exact content SHA; old 18 source lock unchanged',()=>{
 assert.equal(old.migration_files.length,18);
 assert.equal(current.migration_files.length,19);
 assert.deepEqual(current.migration_files.slice(0,18),old.migration_files);
 assert.equal(current.approved_release,'NO_GO');
 for(const [gate,passed] of Object.entries(current.gate))
  assert.equal(passed,false,'Production gate must not be inferred from green CI: '+gate);
 const actual=readdirSync(new URL('supabase/migrations/',root))
  .filter(f=>/^\d{14}_v5(?:\d+)?_[a-z0-9_]+\.sql$/.test(f)).sort();
 assert.deepEqual(actual,current.migration_files.map(x=>x.path.split('/').at(-1)));
 for(const file of current.migration_files){
  const buf=readFileSync(new URL(file.path,root));
  const hash=createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
  assert.equal(buf.length,file.bytes,'Source byte mismatch: '+file.path);
  assert.equal(hash,file.git_blob_sha1,'Source SHA mismatch: '+file.path);
 }
});
test('New V5.7 per-project outstanding is net after immutable reversals, with no gross lateral sums',()=>{
 assert.match(oldSql,/from tutor_private\.v5_team_payment_allocations x/);
 assert.match(oldSql,/from tutor_private\.v5_team_advance_applications x/);
 assert.match(sql,/create or replace function public\.v5_team_operations_overview\(/);
 for(const token of ['v56_direct_net_for_lesson(f.lesson_id)',
  'v56_advance_net_for_lesson(f.lesson_id)',
  "'direct_net_cents'", "'advance_net_cents'", "'outstanding_cents'",
  "'ledger_basis','net_after_immutable_reversals'",
  "g.manager_user_id=v_actor","e.plan_code='team'",
  "'cash_verified_by_bank',false"])
  assert.ok(sql.includes(token),'V5.7 net guard missing: '+token);
 assert.doesNotMatch(sql,/coalesce\(d\.cents,0\)|coalesce\(a\.cents,0\)/);
 assert.doesNotMatch(sql,/\b(?:update|delete|truncate)\s+(?:public|tutor_private)\.v5_team_/i);
 assert.match(sql,/grant execute on function public\.v5_team_operations_overview\(uuid,date\)/);
});
test('Manager P1 UI rejects gross RPC output and requires project/Team net balance consistency',()=>{
 for(const token of [
  "ops?.ledger_basis==='net_after_immutable_reversals'",
  'p.confirmed_receivable_cents===p.direct_net_cents+p.advance_net_cents+p.outstanding_cents',
  'overview.confirmed_total_cents',
  'summary.outstandingCents',
  'sameNetTotals',
  'p.direct_net_cents',
  'p.advance_net_cents',
  'cash_verified_by_bank===false'
 ])assert.ok(ui.includes(token),'Missing fail-closed UI guard: '+token);
 execFileSync(process.execPath,['--check',fileURLToPath(new URL('v2/v5-billing.js',root))],{timeout:10000});
});
