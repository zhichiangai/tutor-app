// V5.6 P0-C/D/E and P1 staged contract, no Production connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const file=p=>readFileSync(new URL(p,root),'utf8');
const s14=file('supabase/migrations/20261110050000_v5_6_net_settlement_reconciliation.sql');
const s15=file('supabase/migrations/20261110060000_v5_6_applied_credit_reverse_conservation.sql');
const s16=file('supabase/migrations/20261110070000_v5_6_parent_finance_verified_bridge.sql');
const s17=file('supabase/migrations/20261110080000_v5_6_manager_adjustment_sources.sql');
const s18=file('supabase/migrations/20261110090000_v5_6_allocated_manual_payout_history.sql');
const ui=file('v2/v56-adjustments.js'),family=file('v2/v56-family.js'),
 billing=file('v2/v5-billing.js'),app=file('v2/app.js'),html=file('v2/index.html');
const has=(s,...needles)=>{for(const v of needles)assert.ok(s.includes(v),'Missing guard: '+v)};
test('P0-B every legacy financial read/write RPC switches to private net helpers',()=>{
 for(const n of ['v5_report_team_payment','v5_report_team_payment_with_advance',
  'v5_confirm_team_payment_allocation','v5_confirm_team_advance_payment',
  'v5_apply_team_advance_credit','v5_team_advance_overview',
  'v5_team_payment_overview'])
  has(s14,'create or replace function public.'+n);
 has(s14,'create or replace function tutor_private.v5_guard_combined_lesson_settlement');
 has(s14,'v56_direct_net_for_lesson','v56_advance_net_for_lesson',
  'v56_credit_available','v56_credit_total_reserved');
 assert.doesNotMatch(s14,/\b(delete from|truncate)\s+tutor_private\.v5_team_(?:payment|advance)/i);
});
test('P0-C applied credit request, decision and reversal append-only tables are private',()=>{
 for(const t of ['v56_team_applied_credit_requests','v56_team_applied_credit_decisions',
  'v56_team_advance_application_reversals']){
  has(s15,'create table tutor_private.'+t+'(',
   'alter table tutor_private.'+t+' enable row level security',
   'revoke all on tutor_private.'+t+' from public,anon,authenticated');
  assert.match(s15,new RegExp('before update or delete[\\s\\S]*?on tutor_private\\.'+t));
 }
 has(s15,'v56_request_team_applied_credit_adjustment',
  'v56_decide_team_applied_credit_adjustment','v56_team_conservation_overview',
  'v56_credit_net_applied','v56_credit_total_reserved');
});
test('P0-C only fresh current manager may reverse original application within locked amount',()=>{
 has(s15,'auth.uid()','from public.workspaces w where w.id=v_anchor for update',
  'g.manager_user_id=v_actor',"e.plan_code='team'",
  'v_done>v_original','v_row.amount_cents>v_original-v_done',
  'insert into tutor_private.v56_team_applied_credit_decisions',
  'insert into tutor_private.v56_team_advance_application_reversals');
 has(s15,"'bank_verified',false");
});
test('P0-D Team conservation includes cash versus receivables versus refund reserves',()=>{
 has(s15,'v_credit_created<>v_credit_available+v_credit_applied+v_credit_reserved',
  'v_due:=v_fees-v_direct-v_advance',
  'v_credit_available<0','advance_applied_net_cents',
  'applied_credit_refund_liability_cents',
  'direct_refund_liability_cents','unused_credit_refund_liability_cents',
  'confirmed_cash_book_cents','conservation_passed');
 has(s18,'cash_book_net_after_declared_refunds_cents');
});
test('P0-E V4 personal and Team students require explicit two-sided live guardian bridge',()=>{
 has(s16,'v56_team_family_bridge_proposals','v56_team_family_bridge_acceptances',
  'v56_team_family_bridge_revocations',
  'v56_propose_team_family_bridge','v56_respond_team_family_proposal',
  'v56_team_parent_finance_overview',
  'public.student_guardians sg',
  'sg.student_id=p.v4_student_id','sg.teacher_id=p.v4_teacher_id',
  'sg.guardian_id=v_actor',
  'p.team_student_id=p_team_student_id');
 assert.doesNotMatch(s16,/v4_student_id\s*=\s*team_student_id/);
});
test('P0-E private parent output omits teacher hourly cost and relies on backend',()=>{
 assert.doesNotMatch(s16,/hourly_rate_cents.*jsonb_build_object/);
 has(s16,'correction_refund_history','direct_paid_net_cents',
  'advance_paid_net_cents','bank_verified',false);
 for(const t of ['v56_team_family_bridge_proposals','v56_team_family_bridge_acceptances',
  'v56_team_family_bridge_revocations']){
  has(s16,'alter table tutor_private.'+t+' enable row level security');
 }
});
test('P1 manager original source picker and credit refund capacity honor reversals',()=>{
 has(s17,'v56_team_refundable_allocations','v56_credit_available',
  'v56_team_advance_application_reversals',
  'v56_team_direct_refund_reversals',
  'manager_user_id=v_actor');
});
test('P1 manual payout is a unique immutable declaration, never a bank transfer',()=>{
 has(s18,"unique(source,request_id)",
  'v56_record_allocated_refund_manual_paid',
  'v56_team_allocated_refund_manual_payouts',
  'manual_paid_not_bank_verified',"bank_verified',false",
  'v56_team_conservation_overview','v56_team_parent_finance_overview');
 assert.doesNotMatch(s18,/\b(?:pg_net|http_post|bank_api|stripe)\b/i);
});
test('P1 parent and manager JS modules parse, fail closed and revoke stale finance',()=>{
 for(const name of ['v2/v56-adjustments.js','v2/v56-family.js','v2/v5-billing.js','v2/app.js'])
  execFileSync(process.execPath,['--check',fileURLToPath(new URL(name,root))],{timeout:10000});
 has(family,'v56_my_team_family_proposals','v56_team_parent_finance_overview',
  'v56_respond_team_family_proposal','clear()',"'parent'");
 has(billing,'v56_team_conservation_overview','conservation_passed===true',
  'v56_team_refundable_allocations');
 has(ui,'v56_decide_team_direct_refund',
  'v56_decide_team_applied_credit_adjustment',
  'v56_record_allocated_refund_manual_paid');
 has(app,'v56FamilyUI.clear()','v56FamilyUI.refresh()');
 has(html,'id="v56-parent-family-panel"','id="v56-family-bridge-form"');
});
