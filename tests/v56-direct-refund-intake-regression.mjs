import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261110032000_v5_6_team_allocated_refund_intake.sql',import.meta.url),'utf8');
const block=name=>{
 const m=new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end;\\$\\$;','i').exec(sql);
 assert.ok(m,'Missing '+name);
 return m[0];
};

test('Direct refund intake is explicitly request-only, not an allocated cash reversal or bank payout',()=>{
 assert.match(sql,/DISPOSABLE CI ONLY/);
 assert.match(sql,/does NOT reserve the payment/);
 assert.match(sql,/requested_no_settlement/g);
 assert.match(sql,/settlement_changed',false/g);
 assert.match(sql,/bank_verified',false/g);
 assert.doesNotMatch(sql,/\b(?:update|delete from|truncate)\s+tutor_private\.v5_team_(?:payment|advance|lesson)/i);
 assert.doesNotMatch(sql,/\b(?:update|delete from|truncate|insert into)\s+public\.(?:lesson_records|payment_batches|payment_batch_items)/i);
});

test('Intake ledger is immutable, private, RLS protected and scoped to the original payment student and Team',()=>{
 assert.match(sql,/create table tutor_private\.v56_team_direct_refund_intake\(/);
 assert.match(sql,/alter table tutor_private\.v56_team_direct_refund_intake enable row level security/);
 assert.match(sql,/revoke all on tutor_private\.v56_team_direct_refund_intake from public,anon,authenticated/);
 assert.match(sql,/before update or delete on tutor_private\.v56_team_direct_refund_intake/);
 assert.match(sql,/foreign key\(student_id,team_id\) references public\.v5_team_students\(id,team_id\)/);
 assert.match(sql,/unique\(payment_id,idempotency_key\)/);
});

test('Manager-only request locks V4 workspace, rechecks Team entitlement and validates immutable allocations',()=>{
 const fn=block('v56_request_team_direct_refund');
 assert.match(fn,/auth\.uid\(\)/);
 assert.match(fn,/security definer set search_path=''/);
 assert.match(fn,/from public\.workspaces w where w\.id=v_anchor for update/);
 assert.match(fn,/v5_team_governance/);
 assert.match(fn,/manager_user_id=v_actor/);
 assert.match(fn,/plan_code='team'/);
 assert.match(fn,/v_payment\.status<>'confirmed'/);
 assert.match(fn,/v_row\.lesson_id=any\(v_seen\)/);
 assert.match(fn,/from tutor_private\.v5_team_payment_allocations a/);
 assert.match(fn,/f\.team_id=v_payment\.team_id and f\.student_id=v_payment\.student_id/);
 assert.match(fn,/v_row\.amount_cents>v_allocated/);
 assert.match(fn,/v_existing\.allocations<>p_allocations/);
 assert.match(sql,/revoke all on function public\.v56_request_team_direct_refund/);
 assert.match(sql,/grant execute on function public\.v56_request_team_direct_refund/);
});

test('Only the current manager can see staged direct refund requests',()=>{
 const fn=block('v56_team_direct_refund_intake_overview');
 assert.match(fn,/auth\.uid\(\)/);
 assert.match(fn,/v5_team_governance/);
 assert.match(fn,/manager_user_id=v_actor/);
 assert.match(fn,/plan_code='team'/);
 assert.match(fn,/where r\.team_id=p_team_id/);
 assert.match(fn,/bank_verified',false/);
 assert.match(sql,/revoke all on function public\.v56_team_direct_refund_intake_overview/);
 assert.match(sql,/grant execute on function public\.v56_team_direct_refund_intake_overview/);
});
