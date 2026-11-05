import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL(
 '../supabase/migrations/20261106034000_v5_3_partial_payment_allocation.sql',
 import.meta.url),'utf8');

test('Team partial-payment migration leaves V4 courses, payments, users untouched',()=>{
 assert.doesNotMatch(sql,/\b(?:alter table|insert into|update|delete from|truncate)\s+public\.(?:lesson_records|students|payment_batches|payment_batch_items)\b/i);
 assert.doesNotMatch(sql,/update\s+public\.workspaces\s+set\s+owner_id/i);
 assert.doesNotMatch(sql,/grant\s+(?:select|update|delete|insert)\s+on\s+public\.(?:payment_batches|lesson_records)/i);
});
test('Payment, allocation and audit records are private, immutable to browsers',()=>{
 for(const name of ['v5_team_payment_reports','v5_team_payment_allocations','v5_team_payment_audit']){
  assert.match(sql,new RegExp('create table tutor_private\\.'+name+'\\('));
  assert.match(sql,new RegExp('alter table tutor_private\\.'+name+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on tutor_private\\.'+name+'\\s+from public,anon,authenticated'));
  assert.doesNotMatch(sql,new RegExp('grant\\s+(?:all|select|insert|update|delete)\\s+on tutor_private\\.'+name+'\\s+to authenticated','i'));
 }
 assert.match(sql,/unique\(team_id,reference\)/);
 assert.match(sql,/primary key\(payment_id,lesson_id\)/);
 assert.match(sql,/foreign key\(student_id,team_id\)/);
});
test('All payment operations recheck current manager and active Team plan',()=>{
 for(const name of ['v5_report_team_payment','v5_confirm_team_payment_allocation','v5_team_payment_overview']){
  const rpc=new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end;\\$\\$;','i').exec(sql)?.[0];
  assert.ok(rpc,'Missing RPC '+name);
  assert.match(rpc,/security definer set search_path=''/);
  assert.match(rpc,/auth\.uid\(\)/);
  assert.match(rpc,/v5_team_governance/);
  assert.match(rpc,/manager_user_id=v_actor/);
  assert.match(rpc,/plan_code='team'/);
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\('));
 }
});
test('Allocation is transactional and protected against duplicates, partial rollbacks and overspend',()=>{
 assert.match(sql,/for update;/);
 assert.match(sql,/order by a\.lesson_id/);
 assert.match(sql,/v_item\.lesson_id=any\(v_seen\)/);
 assert.match(sql,/v_fee\.team_id<>v_payment\.team_id/);
 assert.match(sql,/v_fee\.student_id<>v_payment\.student_id/);
 assert.match(sql,/v_applied\+v_item\.amount_cents>v_fee\.amount_cents/);
 assert.match(sql,/v_sum<>v_payment\.amount_cents/);
 assert.match(sql,/insert into tutor_private\.v5_team_payment_allocations/);
 assert.match(sql,/status='confirmed',confirmed_by=v_actor/);
 assert.match(sql,/insert into tutor_private\.v5_team_payment_audit/);
});
test('Payment reporting never declares gateway verification or V5.4 prepayment',()=>{
 assert.match(sql,/status text not null default 'pending'/);
 assert.match(sql,/received_on date not null/);
 assert.match(sql,/amount_cents bigint not null check\(amount_cents between 1 and 1000000000\)/);
 assert.doesNotMatch(sql,/create table.*\b(?:prepayment|refund|bank_account)\b/i);
});
