// Contract only; full authorization and money invariants require disposable JWT CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261110040000_v5_6_team_direct_refund_approval_reversal.sql',import.meta.url),'utf8');
const block=name=>{
 const m=new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end;\\$\\$;','i').exec(sql);
 assert.ok(m,'Missing RPC '+name);
 return m[0];
};
test('Private decision and per-lesson reversal rows are immutable and RLS protected',()=>{
 for(const name of ['v56_team_direct_refund_decisions','v56_team_direct_refund_reversals']){
  assert.match(sql,new RegExp('create table tutor_private\\.'+name+'\\('));
  assert.match(sql,new RegExp('alter table tutor_private\\.'+name+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on tutor_private\\.'+name+' from public,anon,authenticated'));
  assert.match(sql,new RegExp('before update or delete[\\s\\S]*?on tutor_private\\.'+name));
 }
 assert.match(sql,/foreign key\(payment_id,lesson_id\) references tutor_private\.v5_team_payment_allocations/);
});
test('Review RPC rechecks manager, locks workspace, idempotently approves or rejects',()=>{
 const fn=block('v56_decide_team_direct_refund');
 for(const token of [
  'auth.uid()',"security definer set search_path=''",
  'from public.workspaces w where w.id=v_anchor for update',
  'manager_user_id=v_actor',"plan_code='team'",
  "v_payment.status<>'confirmed'",
  'v_fee.team_id<>v_req.team_id',
  'v_fee.student_id<>v_req.student_id',
  'v_reversed>v_original',
  'v_item.amount_cents>v_original-v_reversed',
  'v_sum<>v_req.amount_cents',
  'v_prior.approved is distinct from p_approve',
  'insert into tutor_private.v56_team_direct_refund_decisions',
  'insert into tutor_private.v56_team_direct_refund_reversals'
 ]) assert.ok(fn.includes(token),'Missing review security/settlement guard: '+token);
 assert.match(sql,/revoke all on function public\.v56_decide_team_direct_refund/);
 assert.match(sql,/grant execute on function public\.v56_decide_team_direct_refund\(uuid,boolean,text\)[\s\S]*?to authenticated/);
});
test('Manager-only net read model distinguishes reopened receivable from cash payout',()=>{
 const fn=block('v56_team_direct_refund_net_overview');
 assert.match(fn,/manager_user_id=v_actor/);
 assert.match(fn,/where f.team_id=p_team_id/);
 assert.match(fn,/direct_net_allocated_cents/);
 assert.match(fn,/outstanding_cents/);
 assert.match(fn,/all_time_direct_refund_liability_cents/);
 assert.match(fn,/physical_bank_refund_verified',false/);
 assert.match(fn,/legacy_gross_overview_is_net_authoritative',false/);
 assert.doesNotMatch(sql,/\b(?:update|delete from|truncate)\s+tutor_private\.v5_team_(?:payment|advance|lesson)/i);
 assert.doesNotMatch(sql,/\b(?:insert into|update|delete from)\s+public\.(?:payment_batches|lesson_records)/i);
 assert.doesNotMatch(sql,/\bbank_verified',true/);
});