import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL(
 '../supabase/migrations/20261106043000_v5_4_team_advance_credit.sql',
 import.meta.url),'utf8');
const old=readFileSync(new URL(
 '../supabase/migrations/20261106034000_v5_3_partial_payment_allocation.sql',
 import.meta.url),'utf8');

test('V5.4 migration is additive and never writes V4 finance or personal lessons',()=>{
 assert.doesNotMatch(sql,
  /\b(?:alter table|insert into|update|delete from|truncate)\s+public\.(?:lesson_records|students|payment_batches|payment_batch_items)\b/i);
 assert.doesNotMatch(sql,/update\s+public\.workspaces\s+set\s+owner_id/i);
 assert.match(old,/create function public\.v5_report_team_payment\(/,
  'Original V5.3 strict payment RPC is preserved');
});

test('All credit, operation, intent, application and audit tables are private RLS',()=>{
 for(const name of ['v5_team_advance_intents','v5_team_advance_credits',
  'v5_team_advance_operations','v5_team_advance_applications',
  'v5_team_advance_audit']){
  assert.match(sql,new RegExp('create table tutor_private\\.'+name+'\\('));
  assert.match(sql,new RegExp('alter table tutor_private\\.'+name+
   ' enable row level security'));
  assert.match(sql,new RegExp('revoke all on tutor_private\\.'+name+
   '\\s+from public,anon,authenticated'));
  assert.doesNotMatch(sql,new RegExp(
   'grant\\s+(?:all|select|update|delete|insert)\\s+on tutor_private\\.'+
   name+'\\s+to authenticated','i'));
 }
 assert.match(sql,/unique\(credit_id,idempotency_key\)/);
 assert.match(sql,/primary key\(operation_id,lesson_id\)/);
 assert.match(sql,/payment_id uuid not null unique references/);
});

test('All manager operations recheck current governance and Team entitlement',()=>{
 for(const name of [
  'v5_report_team_payment_with_advance',
  'v5_confirm_team_advance_payment','v5_team_advance_overview',
  'v5_apply_team_advance_credit']){
  const block=new RegExp('create function public\\.'+name+
   '\\([\\s\\S]*?end;\\$\\$;','i').exec(sql)?.[0];
  assert.ok(block,'Missing '+name);
  assert.match(block,/security definer set search_path=''/);
  assert.match(block,/auth\.uid\(\)/);
  assert.match(block,/v5_team_governance/);
  assert.match(block,/manager_user_id=v_actor/);
  assert.match(block,/plan_code='team'/);
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\('));
 }
});

test('Advance creation and application protect payment and lesson invariants',()=>{
 assert.match(sql,/create trigger v5_guard_advance_payment_confirmation/);
 assert.match(sql,/create trigger v5_guard_payment_combined_settlement/);
 assert.match(sql,/create trigger v5_guard_advance_combined_settlement/);
 assert.match(sql,/v_direct\+v_advance\+new\.amount_cents>v_fee\.amount_cents/);
 assert.match(sql,/v_sum<>v_payment\.amount_cents-v_credit_cents/);
 assert.match(sql,/insert into tutor_private\.v5_team_payment_allocations/);
 assert.match(sql,/insert into tutor_private\.v5_team_advance_credits/);
 assert.match(sql,/update tutor_private\.v5_team_payment_reports/);
 assert.match(sql,/status='confirmed',confirmed_by=v_actor/);
 assert.match(sql,/insert into tutor_private\.v5_team_advance_audit/);
 assert.match(sql,/v_fee\.team_id<>v_credit\.team_id/);
 assert.match(sql,/v_fee\.student_id<>v_credit\.student_id/);
 assert.match(sql,/v_total>v_balance-v_row\.amount_cents/);
 assert.match(sql,/v_prior\.requested_allocations<>p_allocations/);
 assert.match(sql,/for update;/);
});

test('Read-only offset suggestions are distinct from manager-confirmed allocations',()=>{
 const overview=sql.match(
  /create function public\.v5_team_advance_overview\([\s\S]*?end;\$\$;/i)?.[0];
 assert.ok(overview);
 assert.match(overview,/suggestions/);
 assert.match(overview,/preceding_due/);
 assert.doesNotMatch(overview,/\b(?:insert into|update|delete from)\b/i);
 assert.match(sql,/credit_created/);
 assert.match(sql,/credit_applied/);
 assert.doesNotMatch(sql,/\b(?:bank_verified|refund_processed|gateway_confirmed)\b/i,
  'No invented bank verification or refund processing');
});
