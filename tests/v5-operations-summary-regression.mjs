import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveV5ManagerOperations} from '../v2/v5-operations-summary.js';

function snapshots(){
 const team='team-A',month='2026-11-01';
 const billing={team_id:team,month,currency:'TWD',confirmed_total_cents:8000,
  confirmed_count:2,confirmed_rows:[
   {lesson_id:'a',amount_cents:5000},
   {lesson_id:'b',amount_cents:3000}
  ],pending_rows:[{lesson_id:'c'}]};
 const payments={team_id:team,month,currency:'TWD',
  confirmed_payments_cents:7000,outstanding_cents:2000,
  advance_created_cents:2000,advance_available_cents:4000,
  receivables:[
   {lesson_id:'a',student_id:'student-A',amount_cents:5000,
    direct_allocated_cents:2000,advance_applied_cents:1000,
    allocated_cents:3000,outstanding_cents:2000},
   {lesson_id:'b',student_id:'student-A',amount_cents:3000,
    direct_allocated_cents:3000,advance_applied_cents:0,
    allocated_cents:3000,outstanding_cents:0}
  ],
  payments:[
   {payment_id:'p1',status:'confirmed',amount_cents:7000,advance_credit_cents:2000},
   {payment_id:'p2',status:'pending',amount_cents:1200,advance_credit_cents:0}
  ]};
 return {billing,payments};
}

test('manager operations: computes actionable counts without treating balances as paid twice',()=>{
 const {billing,payments}=snapshots();
 const r=deriveV5ManagerOperations(billing,payments);
 assert.equal(r.unconfirmedLessonCount,1);
 assert.equal(r.pendingPaymentCount,1);
 assert.equal(r.unpaidLessonCount,1);
 assert.equal(r.unpaidStudentCount,1);
 assert.equal(r.outstandingCents,2000);
 assert.equal(r.availableAdvanceCents,4000);
 assert.equal(r.needsReconciliation,false);
 assert.deepEqual(r.issues,[]);
 assert.equal(Object.keys(r).some(k=>k.includes('actor')||k.includes('email')),false);
});

test('cross-team, cross-month, non-TWD and absent manager snapshots never show stale figures',()=>{
 const {billing,payments}=snapshots();
 assert.equal(deriveV5ManagerOperations(null,payments),null);
 assert.equal(deriveV5ManagerOperations(billing,null),null);
 assert.equal(deriveV5ManagerOperations(billing,{...payments,team_id:'team-B'}),null);
 assert.equal(deriveV5ManagerOperations(billing,{...payments,month:'2026-12-01'}),null);
 assert.equal(deriveV5ManagerOperations({...billing,currency:'USD'},payments),null);
});

test('malformed, negative and unsafe amount fields are never rendered as zero',()=>{
 const {billing,payments}=snapshots();
 assert.equal(deriveV5ManagerOperations(billing,{...payments,outstanding_cents:-1}),null);
 assert.equal(deriveV5ManagerOperations(billing,{...payments,
  confirmed_payments_cents:Number.MAX_SAFE_INTEGER+1}),null);
 assert.equal(deriveV5ManagerOperations(billing,{...payments,receivables:null}),null);
 const bad=structuredClone(payments);
 bad.receivables[0].outstanding_cents='2000';
 assert.equal(deriveV5ManagerOperations(billing,bad),null);
});

test('reconciliation flags mismatching amounts without mutating financial source records',()=>{
 const {billing,payments}=snapshots();
 const copy=structuredClone(payments);
 copy.receivables[0].allocated_cents=3200;
 const result=deriveV5ManagerOperations(billing,copy);
 assert.equal(result.needsReconciliation,true);
 assert.ok(result.issues.includes('lesson-settlement-differs'));
 assert.deepEqual(payments,snapshots().payments);
});

test('duplicate receipts or wrong totals produce a review warning, not artificial bank validation',()=>{
 const {billing,payments}=snapshots();
 payments.payments.push({...payments.payments[0]});
 const result=deriveV5ManagerOperations(billing,payments);
 assert.equal(result.needsReconciliation,true);
 assert.ok(result.issues.includes('payment-ids-duplicated'));
 assert.ok(result.issues.includes('receipt-summary-differs'));
});

test('operations card remains manager-only and sourced from existing guarded billing RPCs',()=>{
 const frontend=readFileSync(new URL('../v2/v5-billing.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
 assert.match(frontend,/deriveV5ManagerOperations\(overview,paymentOverview\)/);
 assert.match(frontend,/ready&&valid\(\)&&!loading&&!error/);
 assert.match(frontend,/client\.rpc\('v5_team_billing_overview'/);
 assert.match(frontend,/client\.rpc\('v5_team_payment_overview'/);
 assert.match(html,/id="v5-operations-card"/);
 assert.match(html,/v5-team-panel hidden" id="v5-operations-card"/);
});

test('V5.7 project, teacher and audit sections remain guarded by manager RPC and auto-cleared',()=>{
 const frontend=readFileSync(new URL('../v2/v5-billing.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
 for(const id of ['v5-ops-projects','v5-ops-teachers','v5-ops-activity',
  'v5-ops-report-message'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(frontend,/client\.rpc\('v5_team_operations_overview'/);
 assert.match(frontend,/operationsOverview=operations\.error\?null:operations\.data/);
 assert.match(frontend,/operationsOverview=null/);
 assert.match(frontend,/cash_verified_by_bank===false/);
 assert.match(frontend,/projectList\?\.append/);
});


test('V5.6 voided pending payments are excluded from pending count but retained for audit',()=>{
 const {billing,payments}=snapshots();
 payments.payments[1].status='void';
 const result=deriveV5ManagerOperations(billing,payments);
 assert.ok(result,'Voided payment is a documented valid accounting status');
 assert.equal(result.needsReconciliation,false);
 assert.equal(result.pendingPaymentCount,0);
 assert.equal(result.voidedPaymentCount,1);
 assert.equal(result.unpaidLessonCount,1);
 assert.equal(result.issues.length,0);
 assert.equal(payments.payments[1].status,'void','Original read model is immutable');
});
