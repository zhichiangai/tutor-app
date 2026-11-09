import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261109163000_v5_6_team_refund_correction_ledger.sql',import.meta.url),'utf8');
const rpcNames=[
 'v56_void_team_pending_payment',
 'v56_correct_team_payment_metadata',
 'v56_request_team_credit_refund',
 'v56_decide_team_credit_refund',
 'v56_record_team_refund_manual_paid',
 'v56_team_adjustment_overview'
];
const block=name=>{
 const m=new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end;\\$\\$;','i').exec(sql);
 assert.ok(m,'Missing '+name);
 return m[0];
};

test('V5.6 is additive: never changes V4 personal data or confirms any bank transfer',()=>{
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|truncate|alter table)\s+public\.(?:lesson_records|students|payment_batches|payment_batch_items)\b/i);
 assert.match(sql,/DISPOSABLE CI ONLY/);
 assert.match(sql,/original confirmed fees, payments and allocations/i);
 assert.doesNotMatch(sql,/\bbank_verified\s*[,=:]\s*true\b/i);
});

test('V5.6 private ledger has RLS, no direct browser grants, immutable history triggers',()=>{
 for(const t of [
  'v56_team_pending_payment_voids',
  'v56_team_payment_corrections',
  'v56_team_credit_refund_requests',
  'v56_team_credit_refund_events'
 ]){
  assert.match(sql,new RegExp('create table tutor_private\\.'+t+'\\('));
  assert.match(sql,new RegExp('alter table tutor_private\\.'+t+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on tutor_private\\.'+t+' from public,anon,authenticated'));
  assert.doesNotMatch(sql,new RegExp('grant\\s+(?:select|all|insert|update|delete)\\s+on tutor_private\\.'+t+'\\s+to authenticated','i'));
 }
 assert.equal((sql.match(/before update or delete on tutor_private\.v56_/g)||[]).length,4);
 assert.match(sql,/create unique index v56_refund_decision_once/);
 assert.match(sql,/create unique index v56_refund_paid_once/);
});

test('Every V5.6 exposed RPC has current manager, Team plan and workspace lock',()=>{
 for(const name of rpcNames){
  const fn=block(name);
  assert.match(fn,/auth\.uid\(\)/);
  assert.match(fn,/security definer set search_path=''/);
  assert.match(fn,/v5_team_governance/);
  assert.match(fn,/manager_user_id=v_actor/);
  assert.match(fn,/plan_code='team'/);
  assert.doesNotMatch(fn,/service_role/i);
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\('));
 }
 for(const name of rpcNames.filter(n=>n!=='v56_team_adjustment_overview'))
  assert.match(block(name),/from public\.workspaces w where w\.id=v_anchor for update/);
});

test('Pending payment voids cannot be confirmed or block future pending capacity',()=>{
 const fn=block('v56_void_team_pending_payment');
 assert.match(fn,/v_payment\.status<>'pending'/);
 assert.match(fn,/unique|payment_id uuid primary key/i);
 assert.match(sql,/create or replace function public\.v5_confirm_team_payment_allocation\(/);
 assert.match(sql,/create or replace function public\.v5_confirm_team_advance_payment\(/);
 assert.match(sql,/此待確認付款已沖銷/);
 assert.match(sql,/此待確認預收已沖銷/);
 for(const name of ['v5_report_team_payment','v5_report_team_payment_with_advance'])
  assert.match(sql,new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?v56_team_pending_payment_voids'));
});

test('Immutable confirmed payment metadata correction never overwrites originals',()=>{
 const fn=block('v56_correct_team_payment_metadata');
 assert.match(fn,/p_field not in \('note','method'\)/);
 assert.match(fn,/v_payment\.status<>'confirmed'/);
 assert.match(fn,/v_old\.idempotency_key|v_old\.corrected_field/);
 assert.match(fn,/insert into tutor_private\.v56_team_payment_corrections/);
 assert.doesNotMatch(fn,/update tutor_private\.v5_team_payment_reports/i);
 assert.match(sql,/unique\(payment_id,idempotency_key\)/);
});

test('Credit refund requires separate request, manager decision and manually checked payout',()=>{
 const request=block('v56_request_team_credit_refund');
 const decision=block('v56_decide_team_credit_refund');
 const paid=block('v56_record_team_refund_manual_paid');
 assert.match(request,/v_available/);
 assert.match(decision,/v_available<v_req\.amount_cents/);
 assert.match(decision,/event in \('approved','rejected'\)/);
 assert.match(paid,/event='approved'/);
 assert.match(paid,/manual_paid/);
 assert.match(paid,/bank_verified',false/);
 assert.doesNotMatch(paid,/\b(?:pg_net|http_post|send_email)\b/i);
});

test('V5.4 offset and read models deduct approved refunds under the anchor lock',()=>{
 assert.match(sql,/create or replace function public\.v5_apply_team_advance_credit\(/);
 assert.match(sql,/v_balance:=v_balance-v_refund_reserved/);
 assert.match(sql,/v_total>v_balance-v_row\.amount_cents/);
 assert.match(sql,/create or replace function public\.v5_team_advance_overview\(/);
 assert.match(sql,/c\.amount_cents-coalesce\(a\.used,0\)-coalesce\(r\.reserved,0\)/);
 assert.match(sql,/create or replace function public\.v5_team_payment_overview\(/);
 assert.match(sql,/refund_reserved_cents/);
 assert.match(sql,/manual_paid_refunds_cents/);
 assert.match(sql,/net_cash_movement_cents/);
 assert.match(sql,/bank_verified',false/);
});

test('Privacy: student and other tenants never receive raw private accounting ledgers',()=>{
 const fn=block('v56_team_adjustment_overview');
 assert.match(fn,/where p\.team_id=p_team_id/);
 assert.match(fn,/where r\.team_id=p_team_id/);
 assert.doesNotMatch(fn,/grant execute .* to anon/i);
 assert.match(sql,/refunds_bank_verified',false/);
});
