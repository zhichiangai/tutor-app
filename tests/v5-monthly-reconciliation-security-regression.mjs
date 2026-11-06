import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/migrations/20261106050000_v5_4_team_monthly_reconciliation.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../v2/v5-billing.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');

test('Monthly reconciliation is additive to V5, not a write into V4 finance',()=>{
 assert.match(sql,/create or replace function public\.v5_team_payment_overview\(/);
 assert.match(sql,/create or replace function public\.v5_report_team_payment\(/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|alter table|delete from|truncate)\s+public\.(?:payment_batches|lesson_records|students|payment_batch_items)\b/i);
 assert.match(sql,/security definer set search_path=''/);
 for(const name of ['v5_team_payment_overview','v5_report_team_payment']){
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('));
  assert.match(sql,new RegExp('grant execute on function public\\.'+name+'\\('));
 }
});
test('Monthly outstanding subtracts direct payment and advance applications independently',()=>{
 assert.match(sql,/left join lateral\([\s\S]*?v5_team_payment_allocations/);
 assert.match(sql,/left join lateral\([\s\S]*?v5_team_advance_applications/);
 assert.match(sql,/f\.amount_cents-coalesce\(d\.cents,0\)-coalesce\(a\.cents,0\)/);
 assert.match(sql,/coalesce\(d\.cents,0\)\+coalesce\(a\.cents,0\)/);
 assert.match(sql,/'direct_allocated_cents'/);
 assert.match(sql,/'advance_applied_cents'/);
 assert.match(sql,/'allocated_cents'/);
 assert.match(sql,/'outstanding_cents'/);
 assert.match(sql,/f\.lesson_start>=v_from and f\.lesson_start<v_until/);
});
test('Advance creation and application are not counted twice as received money',()=>{
 assert.match(sql,/sum\(p\.amount_cents\) filter\(where p\.status='confirmed'\)/);
 assert.match(sql,/'confirmed_payments_cents'/);
 assert.match(sql,/'advance_created_cents'/);
 assert.match(sql,/'advance_available_cents'/);
 assert.match(sql,/where c\.team_id=p_team_id/);
 assert.doesNotMatch(sql,/v_confirmed\s*:?=\s*v_confirmed\s*\+/);
});
test('V5.3 manual payment capacity also subtracts applied advance and pending direct reports',()=>{
 assert.match(sql,/v_pending_direct/);
 assert.match(sql,/left join tutor_private\.v5_team_advance_intents i on i\.payment_id=p\.id/);
 assert.match(sql,/p\.amount_cents-coalesce\(i\.expected_credit_cents,0\)/);
 assert.match(sql,/p_amount_cents>v_due-v_pending_direct/);
 assert.match(sql,/manager_user_id=v_actor/);
 assert.match(sql,/plan_code='team'/);
});
test('Manager UI keeps cash, advance creation, offset and available credit separate',()=>{
 for(const name of [
  'v5-payment-confirmed-total','v5-payment-outstanding-total',
  'v5-payment-advance-created-total','v5-payment-advance-applied-total',
  'v5-payment-advance-available-total'
 ]){
  assert.match(html,new RegExp('id="'+name+'"'));
  assert.ok(ui.includes(name),'Missing GUI amount binding '+name);
 }
 assert.match(ui,/money\(report\.advance_available_cents\?\?0\)/);
 assert.match(ui,/money\(report\.advance_applied_cents\?\?0\)/);
 assert.match(ui,/if\(p\.intended_advance_cents>0\)/);
});
