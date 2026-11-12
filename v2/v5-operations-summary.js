// V5.6/V5.7 manager-only read-only operations summary from existing guarded RPCs.
// Never use this derived UI model as a source of accounting truth or authorization.
// All server-side permissions remain with v5_team_billing_overview and
// v5_team_payment_overview; unauthorised sessions must not supply this data.
const cents=n=>Number.isSafeInteger(n)&&n>=0;
const total=(xs,key)=>xs.reduce((sum,row)=>sum+row[key],0);

export function deriveV5ManagerOperations(billing,payments){
 if(!billing||!payments||typeof billing!=='object'||typeof payments!=='object')
  return null;
 if(!billing.team_id||!billing.month||billing.team_id!==payments.team_id||
    billing.month!==payments.month||billing.currency!=='TWD'||
    payments.currency!=='TWD')return null;
 const confirmed=billing.confirmed_rows,pending=billing.pending_rows,
  fees=payments.receivables,reports=payments.payments;
 if(![confirmed,pending,fees,reports].every(Array.isArray))return null;
 if(![
  billing.confirmed_total_cents,billing.confirmed_count,
  payments.confirmed_payments_cents,payments.outstanding_cents,
  payments.advance_created_cents,payments.advance_available_cents
 ].every(cents))return null;
 if(confirmed.some(x=>!cents(x.amount_cents))||
    reports.some(x=>!cents(x.amount_cents)||!cents(x.advance_credit_cents)||
      !['pending','confirmed','void'].includes(x.status))||
    fees.some(x=>![
      x.amount_cents,x.direct_allocated_cents,x.advance_applied_cents,
      x.allocated_cents,x.outstanding_cents
    ].every(cents)))return null;
 const issues=[];
 const add=code=>{if(!issues.includes(code))issues.push(code)};
 if(confirmed.length!==billing.confirmed_count||
    total(confirmed,'amount_cents')!==billing.confirmed_total_cents)
  add('fee-summary-differs');
 if(fees.length!==confirmed.length||
    new Set(fees.map(x=>x.lesson_id)).size!==fees.length||
    new Set(confirmed.map(x=>x.lesson_id)).size!==confirmed.length||
    fees.some(x=>!confirmed.some(y=>y.lesson_id===x.lesson_id)))
  add('fee-rows-differ');
 for(const fee of fees){
  if(fee.allocated_cents!==fee.direct_allocated_cents+
     fee.advance_applied_cents||
     fee.amount_cents!==fee.allocated_cents+fee.outstanding_cents)
   add('lesson-settlement-differs');
 }
 if(total(fees,'outstanding_cents')!==payments.outstanding_cents)
  add('outstanding-summary-differs');
 const confirmedReports=reports.filter(x=>x.status==='confirmed');
 if(total(confirmedReports,'amount_cents')!==
    payments.confirmed_payments_cents)
  add('receipt-summary-differs');
 if(total(confirmedReports,'advance_credit_cents')!==
    payments.advance_created_cents)
  add('advance-summary-differs');
 if(new Set(reports.map(x=>x.payment_id)).size!==reports.length)
  add('payment-ids-duplicated');
 const unpaid=fees.filter(x=>x.outstanding_cents>0);
 return {
  teamId:billing.team_id,month:billing.month,
  unconfirmedLessonCount:pending.length,
  pendingPaymentCount:reports.filter(x=>x.status==='pending').length,
  voidedPaymentCount:reports.filter(x=>x.status==='void').length,
  unpaidLessonCount:unpaid.length,
  unpaidStudentCount:new Set(unpaid.map(x=>x.student_id)).size,
  outstandingCents:payments.outstanding_cents,
  availableAdvanceCents:payments.advance_available_cents,
  // Only a simple reconciliation hint; not proof of bank receipts, refunds,
  // actual cash, overdue dates, or full ledger correctness.
  needsReconciliation:issues.length>0,
  issues
 };
}
