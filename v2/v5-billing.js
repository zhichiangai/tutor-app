import {deriveV5ManagerOperations} from './v5-operations-summary.js';
import {createV56AdjustmentsUI} from './v56-adjustments.js';
// V5.3 Team receivables: manager-only, immutable course fee confirmations.
// This module has no payment collection or V4 accounting API access.
export function createV5BillingUI({getClient,getUser,getRole,isReady,notify}){
 const $=id=>document.getElementById(id);
 const item=(tag,label,klass)=>{
  const n=document.createElement(tag);
  if(label!==undefined)n.textContent=String(label??'');
  if(klass)n.className=klass;
  return n;
 };
 const money=cents=>{
  const amount=Number(cents);
  if(!Number.isSafeInteger(amount)||amount<0)return '金額不可用';
  return new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',
   minimumFractionDigits:0,maximumFractionDigits:2}).format(amount/100);
 };
 let generation=0,attached=false,ready=false,loading=false,writing=false,error='';
 let availableTeams=[],teamId='',overview=null,paymentOverview=null,operationsOverview=null,adjustmentsOverview=null;
 let advanceStudents=[],advanceStudentId='',advanceOverview=null;
 let advanceReference='manual-advance-'+crypto.randomUUID();
 const retryAdvanceOperations=new Map();
 let paymentReference='manual-'+crypto.randomUUID();
 const today=new Date();
 let month=new Date(today.getFullYear(),today.getMonth(),1);
 const valid=()=>!!(isReady()&&getRole()==='teacher'&&getUser()?.id&&getClient());
 const adjustments=createV56AdjustmentsUI({getClient,notify,refresh});
 const renderAdjustments=allowed=>{
  const summary=allowed&&overview&&paymentOverview?
   deriveV5ManagerOperations(overview,paymentOverview):null;
  adjustments.render({
   allowed:!!allowed,teamId,
   safetyPassed:!!summary&&!summary.needsReconciliation,
   month:[month.getFullYear(),String(month.getMonth()+1).padStart(2,'0'),'01'].join('-'),
   paymentOverview,advanceOverview,adjustments:adjustmentsOverview
  });
 };
 function reset(){
  generation++;ready=false;loading=false;writing=false;error='';
  availableTeams=[];teamId='';overview=null;paymentOverview=null;operationsOverview=null;adjustmentsOverview=null;
  adjustments.reset();
  advanceStudents=[];advanceStudentId='';advanceOverview=null;
  advanceReference='manual-advance-'+crypto.randomUUID();
  retryAdvanceOperations.clear();
  $('v5-operations-card')?.classList.add('hidden');
  for(const id of ['v5-ops-projects','v5-ops-teachers','v5-ops-activity'])
   $(id)?.replaceChildren();
  for(const id of ['v5-ops-pending-fees','v5-ops-pending-payments',
   'v5-ops-unpaid-lessons','v5-ops-unpaid-students',
   'v5-ops-reconciliation','v5-ops-report-message']){
   if($(id))$(id).textContent='';
  }
  $('v5-advance-panel')?.classList.add('hidden');
  paymentReference='manual-'+crypto.randomUUID();
  $('v5-billing-card')?.classList.add('hidden');
  for(const id of ['v5-billing-message','v5-billing-pending',
    'v5-billing-confirmed','v5-billing-total',
    'v5-payment-pending-reports','v5-payment-confirmed-reports',
    'v5-payment-confirmed-total','v5-payment-outstanding-total',
    'v5-payment-advance-created-total','v5-payment-advance-applied-total',
    'v5-payment-advance-available-total',
    'v5-advance-message','v5-advance-pending-payments',
    'v5-advance-available','v5-advance-credit-rows']){
   $(id)?.replaceChildren();
  }
  for(const id of ['v5-billing-team-select','v5-payment-student-select',
   'v5-advance-student-select'])$(id)?.replaceChildren();
  for(const id of ['v5-payment-amount','v5-payment-note',
   'v5-advance-amount','v5-advance-credit','v5-advance-note']){
   const input=$(id);if(input)input.value='';
  }
 }
 function options(element,items){
  element.replaceChildren();
  for(const it of items){
   const opt=item('option',it.label);opt.value=it.value;element.append(opt);
  }
 }
 function renderOperations(){
  const panel=$('v5-operations-card');
  if(!panel)return;
  // Only show after current manager's two independent RPCs succeed for
  // the same Team/month. Never trust local UI mode as an access grant.
  const allowed=ready&&valid()&&!loading&&!error&&!!teamId;
  const summary=allowed?deriveV5ManagerOperations(overview,paymentOverview):null;
  panel.classList.toggle('hidden',!summary);
  const fields={
   'v5-ops-pending-fees':summary?.unconfirmedLessonCount,
   'v5-ops-pending-payments':summary?.pendingPaymentCount,
   'v5-ops-unpaid-lessons':summary?.unpaidLessonCount,
   'v5-ops-unpaid-students':summary?.unpaidStudentCount
  };
  for(const [id,value] of Object.entries(fields)){
   if($(id))$(id).textContent=summary?String(value):'';
  }
  const msg=$('v5-ops-reconciliation');
  if(msg)msg.textContent=!summary?'':summary.needsReconciliation?
   '帳務摘要與明細需人工複核，請暫停更正與退款。':
   '僅顯示課程及人工付款待辦；不代表已驗證銀行入帳或完成退款。';
  const projectList=$('v5-ops-projects'),teacherList=$('v5-ops-teachers'),
   history=$('v5-ops-activity'),note=$('v5-ops-report-message');
  for(const view of [projectList,teacherList,history])view?.replaceChildren();
  const ops=operationsOverview;
  const number=x=>Number.isSafeInteger(x)&&x>=0;
  const same=!!summary&&ops?.team_id===summary.teamId&&
   ops?.month===summary.month&&ops?.currency==='TWD'&&
   ops?.financial_authority==='manager_only'&&
   ops?.cash_verified_by_bank===false;
  const validProjects=same&&Array.isArray(ops.projects)&&
   ops.projects.every(p=>p.project_id&&typeof p.name==='string'&&
    ['active','archived'].includes(p.status)&&[
     p.assigned_teacher_count,p.enrolled_student_count,p.scheduled_lessons,
     p.completed_lessons,p.cancelled_lessons,p.unconfirmed_completed_lessons,
     p.confirmed_receivable_cents,p.outstanding_cents
    ].every(number));
  const validTeachers=same&&Array.isArray(ops.teacher_workload)&&
   ops.teacher_workload.every(t=>typeof t.teacher_user_id==='string'&&
    [t.assigned_project_count,t.scheduled_lessons,t.completed_lessons]
     .every(number));
  const validHistory=same&&Array.isArray(ops.recent_activity)&&
   ops.recent_activity.every(e=>['payment','advance','lesson_fee'].includes(e.kind)
    &&typeof e.event==='string'&&typeof e.actor_tail==='string'
    &&typeof e.occurred_at==='string');
  if(note)note.textContent=!summary?'':!same?
   '完整專案營運報表尚無有效資料；上述待辦僅供參考。':
   !(validProjects&&validTeachers&&validHistory)?
   '專案營運資料需要重新核對，請重新整理。':
   '以下報表由現任 Team 管理者授權 RPC 提供，並非銀行入帳、退款或法定會計報表。';
  if(!validProjects||!validTeachers||!validHistory)return;
  if(!ops.projects.length)projectList?.append(
   item('p','尚無 Team 專案。','section-sub'));
  for(const p of ops.projects){
   const row=item('div',undefined,'v5-billing-row');
   row.append(item('strong',p.name+(p.status==='archived'?' · 已封存':'')));
   row.append(item('span','老師 '+p.assigned_teacher_count+
    ' 人 · 學生 '+p.enrolled_student_count+
    ' 人 · 排程 '+p.scheduled_lessons+
    ' 堂 · 完成 '+p.completed_lessons+
    ' 堂 · 取消 '+p.cancelled_lessons+' 堂','section-sub'));
   row.append(item('span','待確認費用 '+p.unconfirmed_completed_lessons+
    ' 堂 · 已確認應收 '+money(p.confirmed_receivable_cents)+
    ' · 未結清 '+money(p.outstanding_cents),'section-sub'));
   projectList?.append(row);
  }
  if(!ops.teacher_workload.length)teacherList?.append(
   item('p','尚無老師名單。','section-sub'));
  for(const t of ops.teacher_workload){
   const row=item('div',undefined,'v5-billing-row');
   row.append(item('strong','老師（帳號末碼 '+
    t.teacher_user_id.slice(-6)+'）'));
   row.append(item('span','指派專案 '+t.assigned_project_count+
    ' · 本月排程 '+t.scheduled_lessons+
    ' · 已完成 '+t.completed_lessons,'section-sub'));
   teacherList?.append(row);
  }
  if(!ops.recent_activity.length)history?.append(
   item('p','目前沒有近期帳務操作。','section-sub'));
  for(const e of ops.recent_activity){
   const row=item('div',undefined,'v5-billing-row');
   const label={payment:'人工付款',advance:'預收抵扣',lesson_fee:'應收費用'}[e.kind];
   const when=new Date(e.occurred_at);
   const at=Number.isFinite(when.valueOf())?
    when.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):
    '時間不可用';
   row.append(item('strong',label+' · '+e.event));
   row.append(item('span',at+' · 操作者末碼 '+
    e.actor_tail.slice(-6),'section-sub'));
   history?.append(row);
  }
 }
 function render(){
  const card=$('v5-billing-card');
  if(!card)return;
  if(!valid()||(!ready&&!loading&&!error)){
   card.classList.add('hidden');renderOperations();renderAdjustments(false);return;
  }
  // Never display any amount to users without a current successful manager RPC.
  const shown=availableTeams.length>0;
  card.classList.toggle('hidden',!shown);
  if(!shown){renderOperations();renderAdjustments(false);return;}
  $('v5-billing-message').textContent=loading?'正在檢查 Team 帳務權限…':
   error||'僅記錄應收費用，不代表家長已付款。確認後不能直接修改金額。';
  const select=$('v5-billing-team-select');
  options(select,availableTeams.map(t=>({
   value:t.id,label:'Team · '+t.id.slice(-8)
  })));
  if(availableTeams.some(t=>t.id===teamId))select.value=teamId;
  $('v5-billing-month-label').textContent=
   new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'long'}).format(month);
  const pending=$('v5-billing-pending'),confirmed=$('v5-billing-confirmed');
  pending.replaceChildren();confirmed.replaceChildren();
  $('v5-billing-total').textContent=overview?
   money(overview.confirmed_total_cents):'尚無可用資料';
  if(!overview){
   renderOperations();
   renderAdjustments(false);
   for(const id of ['v5-payment-pending-reports','v5-payment-confirmed-reports']){
    $(id).replaceChildren();
   }
   $('v5-payment-confirmed-total').textContent='';
   $('v5-payment-outstanding-total').textContent='';
   $('v5-payment-advance-created-total').textContent='';
   $('v5-payment-advance-applied-total').textContent='';
   $('v5-payment-advance-available-total').textContent='';
   $('v5-payment-student-select').replaceChildren();
   $('v5-payment-report-submit').disabled=true;
   return;
  }
  const waiting=Array.isArray(overview.pending_rows)?overview.pending_rows:[];
  if(!waiting.length)pending.append(item('p','本月份沒有待確認費用的已完成課程。','section-sub'));
  for(const row of waiting){
   const wrap=item('div',undefined,'v5-billing-row');
   const lesson=item('strong',row.student_name+' · '+row.subject);
   wrap.append(lesson);
   wrap.append(item('span',new Date(row.lesson_start).toLocaleString('zh-TW',{
    timeZone:'Asia/Taipei',month:'numeric',day:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:false
   })+' · 授課老師 '+String(row.teacher_user_id).slice(-6),'section-sub'));
   const field=item('label','每小時費用（新臺幣元）');
   const input=item('input');
   input.type='number';input.min='0';input.max='1000000';input.step='1';
   input.required=true;input.placeholder='例如：650';
   input.dataset.v5BillingRateFor=row.lesson_id;
   field.append(input);wrap.append(field);
   const confirm=item('button','確認應收費用','secondary-button');
   confirm.type='button';confirm.disabled=writing;
   confirm.dataset.v5BillingAction='confirm';
   confirm.dataset.id=row.lesson_id;wrap.append(confirm);
   pending.append(wrap);
  }
  const records=Array.isArray(overview.confirmed_rows)?overview.confirmed_rows:[];
  if(!records.length)confirmed.append(item('p','本月份尚無確認的應收費用。','section-sub'));
  for(const row of records){
   const wrap=item('div',undefined,'v5-billing-row');
   wrap.append(item('strong',row.student_name+' · '+row.subject+' · '+
     money(row.amount_cents)));
   wrap.append(item('span','老師 '+String(row.teacher_user_id).slice(-6)+
    ' · '+row.duration_minutes+' 分鐘 · 時薪 '+money(row.hourly_rate_cents),
    'section-sub'));
   confirmed.append(wrap);
  }
  renderPayments();
  renderAdvance();
  renderOperations();
  renderAdjustments(true);
 }
 function taipeiDate(){
  const fields=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const v=k=>fields.find(x=>x.type===k)?.value||'00';
  return [v('year'),v('month'),v('day')].join('-');
 }
 function renderPayments(){
  const pending=$('v5-payment-pending-reports'),done=$('v5-payment-confirmed-reports');
  pending.replaceChildren();done.replaceChildren();
  const report=paymentOverview;
  $('v5-payment-confirmed-total').textContent=report?
   money(report.confirmed_payments_cents):'—';
  $('v5-payment-outstanding-total').textContent=report?
   money(report.outstanding_cents):'—';
  $('v5-payment-advance-created-total').textContent=report?
   money(report.advance_created_cents??0):'—';
  $('v5-payment-advance-applied-total').textContent=report?
   money(report.advance_applied_cents??0):'—';
  $('v5-payment-advance-available-total').textContent=report?
   money(report.advance_available_cents??0):'—';
  const fees=Array.isArray(report?.receivables)?report.receivables:[];
  const studentNames=new Map(fees.filter(x=>x.outstanding_cents>0)
   .map(x=>[x.student_id,x.student_name]));
  const chosen=$('v5-payment-student-select').value;
  options($('v5-payment-student-select'),[...studentNames].map(([id,name])=>({
   value:id,label:name+' · '+id.slice(-6)
  })));
  if(studentNames.has(chosen))$('v5-payment-student-select').value=chosen;
  $('v5-payment-report-submit').disabled=writing||studentNames.size===0;
  const payments=Array.isArray(report?.payments)?report.payments:[];
  for(const p of payments){
   const row=item('div',undefined,'v5-billing-row');
   row.append(item('strong',p.student_name+' · '+money(p.amount_cents)));
   row.append(item('span',p.received_on+' · '+({
    cash:'現金',bank_transfer:'銀行轉帳',other:'其他'
   }[p.method]||'其他')+' · '+p.status,'section-sub'));
   if(p.status==='pending'){
    if(p.intended_advance_cents>0){
     row.append(item('span','預計認列預收 '+money(p.intended_advance_cents)+
      '，須使用管理者預收款確認流程，不可當作一般付款分配。','section-sub'));
     pending.append(row);
     continue;
    }
    const available=fees.filter(x=>x.student_id===p.student_id&&x.outstanding_cents>0);
    for(const f of available){
     const field=item('label',f.subject+' · 尚欠 '+money(f.outstanding_cents));
     const input=item('input');input.type='number';input.min='0';
     input.max=(f.outstanding_cents/100).toFixed(2);input.step='0.01';
     input.inputMode='decimal';input.placeholder='分配金額（元）';
     input.dataset.v5PaymentId=p.payment_id;
     input.dataset.v5PaymentLesson=f.lesson_id;
     field.append(input);row.append(field);
    }
    const button=item('button','確認款項分配','secondary-button');
    button.type='button';button.disabled=writing||!available.length;
    button.dataset.v5BillingAction='allocate-payment';
    button.dataset.id=p.payment_id;row.append(button);
    pending.append(row);
   }else{
    if(p.advance_credit_cents>0){
     row.append(item('span','其中預收款 '+money(p.advance_credit_cents)+
      '（已包含在上述已確認付款，不重複計入收款）','section-sub'));
    }
    const allocations=Array.isArray(p.allocations)?p.allocations:[];
    for(const a of allocations){
     row.append(item('span',a.subject+'：'+money(a.amount_cents),'section-sub'));
    }
    done.append(row);
   }
  }
  if(!pending.children.length)
   pending.append(item('p','本月份沒有待確認分配的人工付款。','section-sub'));
  if(!done.children.length)
   done.append(item('p','本月份沒有已確認的付款分配。','section-sub'));
 }
 function renderAdvance(){
  const panel=$('v5-advance-panel');
  if(!panel)return;
  const visible=ready&&valid()&&!!teamId&&!!paymentOverview;
  panel.classList.toggle('hidden',!visible);
  if(!visible)return;
  const selected=$('v5-advance-student-select');
  options(selected,advanceStudents.map(s=>({
   value:s.id,label:s.display_name+' · '+s.id.slice(-6)
  })));
  if(advanceStudents.some(s=>s.id===advanceStudentId))selected.value=advanceStudentId;
  const report=$('v5-advance-report-submit');
  report.disabled=writing||!advanceStudentId||!advanceOverview;
  const pending=$('v5-advance-pending-payments');
  const creditRows=$('v5-advance-credit-rows');
  pending.replaceChildren();creditRows.replaceChildren();
  const total=$('v5-advance-available');
  total.replaceChildren();
  const snapshot=advanceOverview;
  $('v5-advance-message').textContent=advanceStudentId?
   snapshot?'管理者資料已核對：所有金額皆為新臺幣，抵扣尚需另外確認。':
   '正在讀取此學生跨月份預收與應收資料…':
   '此 Team 尚無可查看的學生。';
  if(!snapshot){
   pending.append(item('p','請先選擇學生。','section-sub'));
   return;
  }
  total.append(item('strong','目前預收可用 '+money(snapshot.available_cents)));
  total.append(item('p','該學生跨月份未結清課程費用 '+money(snapshot.outstanding_cents),
   'section-sub'));
  const fees=(snapshot.receivables||[]).filter(f=>f.outstanding_cents>0);
  const pend=(paymentOverview.payments||[]).filter(p=>
   p.student_id===advanceStudentId&&p.status==='pending'&&
   p.intended_advance_cents>0);
  for(const p of pend){
   const row=item('div',undefined,'v5-billing-row');
   const direct=p.amount_cents-p.intended_advance_cents;
   row.append(item('strong','待確認付款 '+money(p.amount_cents)+
    ' · 其中預收 '+money(p.intended_advance_cents)));
   row.append(item('span',p.received_on+' · '+p.reference+
    ' · 本次應直接分配 '+money(direct),'section-sub'));
   if(direct>0){
    for(const fee of fees){
     const label=item('label',fee.subject+' · 尚未結清 '+money(fee.outstanding_cents));
     const inp=item('input');
     inp.type='number';inp.step='0.01';inp.min='0';
     inp.max=(fee.outstanding_cents/100).toFixed(2);
     inp.placeholder='直接分配（新臺幣元）';
     inp.inputMode='decimal';
     inp.dataset.v5AdvancePayment=p.payment_id;
     inp.dataset.v5AdvanceLesson=fee.lesson_id;
     label.append(inp);row.append(label);
    }
   }else{
    row.append(item('p','本筆款項全額認列預收，不需分配到現有課程。','section-sub'));
   }
   const button=item('button','管理者確認付款與預收','secondary-button');
   button.type='button';button.disabled=writing;
   button.dataset.v5BillingAction='confirm-advance-payment';
   button.dataset.id=p.payment_id;row.append(button);
   pending.append(row);
  }
  if(!pend.length)
   pending.append(item('p','本月此學生沒有待確認的預收付款。','section-sub'));
  const credits=(snapshot.credits||[]).filter(c=>c.available_cents>0);
  for(const c of credits){
   const row=item('div',undefined,'v5-billing-row');
   row.append(item('strong','預收餘額 '+money(c.available_cents)));
   row.append(item('p','原始預收 '+money(c.amount_cents)+
    ' · 已抵扣 '+money(c.used_cents)+' · '+c.credit_id.slice(-8),'section-sub'));
   let budget=c.available_cents;
   for(const fee of fees){
    const suggested=Math.min(budget,fee.outstanding_cents);
    budget-=suggested;
    const label=item('label',fee.subject+' · 課程日期 '+
     new Date(fee.lesson_start).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei'})+
     ' · 尚未結清 '+money(fee.outstanding_cents));
    const inp=item('input');
    inp.type='number';inp.step='0.01';inp.min='0';
    inp.max=(Math.min(c.available_cents,fee.outstanding_cents)/100).toFixed(2);
    inp.inputMode='decimal';inp.placeholder='抵扣金額（元）';
    if(suggested>0)inp.value=(suggested/100).toFixed(2);
    inp.dataset.v5AdvanceCredit=c.credit_id;
    inp.dataset.v5AdvanceLesson=fee.lesson_id;
    label.append(inp);row.append(label);
   }
   const button=item('button','確認此筆預收抵扣','secondary-button');
   button.type='button';button.disabled=writing||!fees.length;
   button.dataset.v5BillingAction='apply-advance-credit';
   button.dataset.id=c.credit_id;row.append(button);
   creditRows.append(row);
  }
  if(!credits.length)
   creditRows.append(item('p','此學生目前沒有可抵扣的預收餘額。','section-sub'));
 }

 function cents(raw){
  if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(raw).trim()))
   return null;
  const n=Math.round(Number(raw)*100);
  return Number.isSafeInteger(n)?n:null;
 }
 async function submitAdvanceReport(){
  if(!ready||!valid()||writing||!teamId||!advanceStudentId||!advanceOverview)
   return true;
  const amount=cents($('v5-advance-amount').value);
  const credit=cents($('v5-advance-credit').value);
  const date=$('v5-advance-received-date').value;
  const method=$('v5-advance-method').value;
  const note=$('v5-advance-note').value.trim();
  if(amount===null||credit===null||amount<=0||credit<=0||
   credit>amount||amount>1000000000||note.length>250||
   !/^\d{4}-\d{2}-\d{2}$/.test(date)||date>taipeiDate()){
   notify('請確認付款總額、預收金額及日期。預收須大於零且不能超過本次付款。');
   return true;
  }
  const direct=amount-credit;
  const total=(advanceOverview.receivables||[])
   .reduce((sum,f)=>sum+f.outstanding_cents,0);
  if(direct>total){
   notify('直接分配金額超過此學生跨月份尚未結清的課程費用。');
   return true;
  }
  if(!window.confirm('人工登錄付款 '+money(amount)+'：其中預收 '+
   money(credit)+'、待分配到課程 '+money(direct)+
   '。此操作不驗證銀行交易，須再由管理者確認後才正式入帳。'))
   return true;
  writing=true;
  try{
   const {data,error:failure}=await getClient().rpc(
    'v5_report_team_payment_with_advance',{
     p_team_id:teamId,p_student_id:advanceStudentId,
     p_amount_cents:amount,p_expected_credit_cents:credit,
     p_received_on:date,p_method:method,
     p_reference:advanceReference,p_note:note
    });
   if(failure||data?.status!=='pending')throw failure||new Error('Unreported advance');
   advanceReference='manual-advance-'+crypto.randomUUID();
   $('v5-advance-amount').value='';$('v5-advance-credit').value='';
   $('v5-advance-note').value='';
   month=new Date(Number(date.slice(0,4)),Number(date.slice(5,7))-1,1);
   notify('已建立待確認付款。請在下方確認直接分配與預收差額後入帳。');
   await refresh();
  }catch{
   notify('預收款登錄未完成；請查詢是否已有同 reference 的待確認付款，避免重複登錄。');
  }finally{writing=false;render()}
  return true;
 }
 async function handleSubmit(e){
  if(e.target?.id==='v5-advance-report-form'){
   e.preventDefault();return submitAdvanceReport();
  }
  if(e.target?.id!=='v5-payment-report-form')return false;
  e.preventDefault();
  if(!ready||!valid()||writing||!teamId||!paymentOverview)return true;
  const student=$('v5-payment-student-select').value;
  const amount=cents($('v5-payment-amount').value);
  const received=$('v5-payment-received-date').value;
  const method=$('v5-payment-method').value;
  const note=$('v5-payment-note').value.trim();
  const total=(paymentOverview.receivables||[])
    .filter(x=>x.student_id===student)
    .reduce((sum,x)=>sum+x.outstanding_cents,0);
  if(!student||amount===null||amount<=0||amount>1000000000||
   amount>total||!/^\d{4}-\d{2}-\d{2}$/.test(received)||
   received>taipeiDate()||note.length>250){
   notify('請確認學生、付款日期及金額。不得超過所選月份該學生的未結清應收；超額款項待 V5.4。');
   return true;
  }
  if(!window.confirm('確認人工登錄 '+money(amount)+'？此動作不驗證銀行或金流交易，仍需另外分配到課程。'))
   return true;
  writing=true;
  const ref=paymentReference;
  try{
   const {data,error:failure}=await getClient().rpc('v5_report_team_payment',{
    p_team_id:teamId,p_student_id:student,p_amount_cents:amount,
    p_received_on:received,p_method:method,p_reference:ref,p_note:note
   });
   if(failure||data?.status!=='pending')throw failure||new Error('Failed report');
   paymentReference='manual-'+crypto.randomUUID();
   $('v5-payment-amount').value='';
   $('v5-payment-note').value='';
   notify('已登錄待分配款項 '+money(amount)+'，尚未分配到課程');
   await refresh();
  }catch{notify('付款登錄未完成，請確認是否重複登錄或已失去管理權。')}
  finally{writing=false;render()}
  return true;
 }
 function attach(){
  if(attached)return;attached=true;
  $('v5-payment-received-date').value=taipeiDate();
  $('v5-billing-team-select').addEventListener('change',ev=>{
   teamId=ev.target.value;advanceStudentId='';void refresh();
  });
  $('v5-advance-student-select').addEventListener('change',ev=>{
   advanceStudentId=ev.target.value;void refresh();
  });
  $('v5-advance-received-date').value=taipeiDate();
  $('v5-billing-prev').addEventListener('click',()=>{
   month=new Date(month.getFullYear(),month.getMonth()-1,1);void refresh();
  });
  $('v5-billing-next').addEventListener('click',()=>{
   month=new Date(month.getFullYear(),month.getMonth()+1,1);void refresh();
  });
 }
 async function refresh(){
  if(!valid()){reset();return}
  attach();
  const stamp=++generation,userId=getUser().id;
  loading=true;error='';overview=null;paymentOverview=null;
  operationsOverview=null;advanceOverview=null;adjustmentsOverview=null;
  $('v5-advance-panel')?.classList.add('hidden');
  for(const id of ['v5-advance-message','v5-advance-pending-payments',
   'v5-advance-available','v5-advance-credit-rows'])
   $(id)?.replaceChildren();
  render();
  const client=getClient();
  try{
   const [managed,teams]=await Promise.all([
    client.rpc('v5_my_managed_teams'),
    client.from('v5_teams').select('id,anchor_workspace_id')
   ]);
   if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
   if(managed.error||teams.error)throw managed.error||teams.error;
   const workspaces=new Set((managed.data||[]).map(x=>x.workspace_id));
   availableTeams=(teams.data||[]).filter(t=>workspaces.has(t.anchor_workspace_id));
   if(!availableTeams.some(t=>t.id===teamId))teamId=availableTeams[0]?.id||'';
   if(teamId){
    const first=[month.getFullYear(),String(month.getMonth()+1).padStart(2,'0'),'01'].join('-');
    const [result,payments,students,operations,adj]=await Promise.all([
     client.rpc('v5_team_billing_overview',{
      p_team_id:teamId,p_month:first
     }),
     client.rpc('v5_team_payment_overview',{
      p_team_id:teamId,p_month:first
     }),
     client.from('v5_team_students').select('id,team_id,display_name')
      .eq('team_id',teamId),
     client.rpc('v5_team_operations_overview',{
      p_team_id:teamId,p_month:first
     }),
     client.rpc('v56_team_adjustment_overview',{
      p_team_id:teamId,p_month:first
     })
    ]);
    if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
    if(result.error||payments.error||students.error)
     throw result.error||payments.error||students.error;
    overview=result.data;paymentOverview=payments.data;
    operationsOverview=operations.error?null:operations.data;
    adjustmentsOverview=adj.error?null:adj.data;
    advanceStudents=students.data||[];
    if(!advanceStudents.some(s=>s.id===advanceStudentId))
     advanceStudentId=advanceStudents[0]?.id||'';
    advanceOverview=null;
    if(advanceStudentId){
     const credit=await client.rpc('v5_team_advance_overview',{
      p_team_id:teamId,p_student_id:advanceStudentId
     });
     if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
     if(credit.error)throw credit.error;
     advanceOverview=credit.data;
    }
   }else{
    overview=null;paymentOverview=null;operationsOverview=null;adjustmentsOverview=null;
    advanceStudents=[];advanceStudentId='';advanceOverview=null;
   }
   ready=true;
  }catch{
   if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
   overview=null;paymentOverview=null;operationsOverview=null;advanceOverview=null;adjustmentsOverview=null;
   advanceStudents=[];advanceStudentId='';
   error='Team 帳務暫時無法讀取，請重新進入設定頁。';
  }finally{
   if(stamp===generation&&valid()&&getUser()?.id===userId){
    loading=false;render();
   }
  }
 }
 async function handleClick(target){
  if(await adjustments.handleClick(target))return true;
  const btn=target?.closest?.('[data-v5-billing-action]');
  if(!btn)return false;
  if(!valid()||!ready||writing||!overview)return true;
  if(btn.dataset.v5BillingAction==='confirm-advance-payment'){
   const p=(paymentOverview?.payments||[]).find(x=>
    x.payment_id===btn.dataset.id&&x.status==='pending'&&
    x.student_id===advanceStudentId&&x.intended_advance_cents>0);
   if(!p||!advanceOverview)return true;
   const inputs=[...$('v5-advance-pending-payments').querySelectorAll(
    '[data-v5-advance-payment="'+p.payment_id+'"]')];
   const allocations=[];
   for(const input of inputs){
    if(!input.value.trim())continue;
    const amount=cents(input.value);
    if(amount===null){notify('課程分配金額格式不正確');return true;}
    if(amount>0)allocations.push({
     lesson_id:input.dataset.v5AdvanceLesson,amount_cents:amount
    });
   }
   const total=allocations.reduce((n,x)=>n+x.amount_cents,0);
   if(total!==p.amount_cents-p.intended_advance_cents){
    notify('直接分配須合計 '+money(p.amount_cents-p.intended_advance_cents)+
     '，剩餘 '+money(p.intended_advance_cents)+' 才能確認預收。');
    return true;
   }
   if(!window.confirm('確認本次人工付款 '+money(p.amount_cents)+
    '：直接分配 '+money(total)+'，新增預收 '+money(p.intended_advance_cents)+
    '？確認後不能直接修改，須留存稽核紀錄。'))return true;
   writing=true;
   try{
    const {data,error:failure}=await getClient().rpc(
     'v5_confirm_team_advance_payment',{
      p_payment_id:p.payment_id,p_allocations:allocations
     });
    if(failure||data?.status!=='confirmed')throw failure||new Error('Not confirmed');
    notify('付款已確認；已認列預收 '+money(data.credit_cents)+
     '，直接分配 '+money(data.allocated_cents));
    await refresh();
   }catch{notify('未完成預收款確認：請核對權限、應收與分配金額，勿重複建立付款。')}
   finally{writing=false;render()}
   return true;
  }
  if(btn.dataset.v5BillingAction==='apply-advance-credit'){
   const credit=(advanceOverview?.credits||[]).find(x=>
    x.credit_id===btn.dataset.id&&x.available_cents>0);
   if(!credit)return true;
   const inputs=[...$('v5-advance-credit-rows').querySelectorAll(
    '[data-v5-advance-credit="'+credit.credit_id+'"]')];
   const allocations=[];
   for(const input of inputs){
    if(!input.value.trim())continue;
    const amount=cents(input.value);
    if(amount===null){notify('抵扣金額僅接受最多兩位小數');return true;}
    if(amount>0)allocations.push({
     lesson_id:input.dataset.v5AdvanceLesson,amount_cents:amount
    });
   }
   const total=allocations.reduce((n,x)=>n+x.amount_cents,0);
   if(!allocations.length||total>credit.available_cents){
    notify('抵扣總額須大於零且不能超過預收餘額 '+money(credit.available_cents));
    return true;
   }
   if(!window.confirm('管理者確認抵扣 '+money(total)+
    ' 至 '+allocations.length+' 堂課？這會減少應收與預收餘額，不會新增收款。'))
    return true;
   const signature=credit.credit_id+':'+JSON.stringify(allocations);
   if(!retryAdvanceOperations.has(signature))
    retryAdvanceOperations.set(signature,'v5-offset-'+crypto.randomUUID());
   writing=true;
   try{
    const {data,error:failure}=await getClient().rpc(
     'v5_apply_team_advance_credit',{
      p_credit_id:credit.credit_id,p_allocations:allocations,
      p_idempotency_key:retryAdvanceOperations.get(signature)
     });
    if(failure||data?.status!=='confirmed')throw failure||new Error('Not applied');
    retryAdvanceOperations.delete(signature);
    notify(data.idempotent?'已確認先前抵扣操作，不會重複扣款':
     '預收款抵扣成功 '+money(data.applied_cents)+'（不增加收款）');
    await refresh();
   }catch{notify('抵扣未確認；請查看目前餘額再重試，系統會沿用同操作識別避免重複入帳。')}
   finally{writing=false;render()}
   return true;
  }
  if(btn.dataset.v5BillingAction==='allocate-payment'){
   const p=(paymentOverview?.payments||[]).find(x=>
    x.payment_id===btn.dataset.id&&x.status==='pending');
   if(!p)return true;
   const inputs=[...$('v5-payment-pending-reports').querySelectorAll(
    '[data-v5-payment-id="'+p.payment_id+'"]')];
   const allocations=[];
   for(const input of inputs){
    if(!input.value.trim())continue;
    const amount=cents(input.value);
    if(amount===null){notify('請輸入最多兩位小數的正確金額');return true;}
    if(amount>0)allocations.push({
     lesson_id:input.dataset.v5PaymentLesson,amount_cents:amount
    });
   }
   const sum=allocations.reduce((n,x)=>n+x.amount_cents,0);
   if(!allocations.length||sum!==p.amount_cents){
    notify('各課程分配金額必須剛好等於 '+money(p.amount_cents)+'，不允許超額或未分配餘額。');
    return true;
   }
   if(!window.confirm('確定確認這筆款項的分配？完成後不可直接修改，需另行稽核更正。'))
    return true;
   writing=true;render();
   try{
    const {data,error:failure}=await getClient().rpc(
     'v5_confirm_team_payment_allocation',{
      p_payment_id:p.payment_id,p_allocations:allocations
     });
    if(failure||data?.status!=='confirmed')throw failure||new Error('Not confirmed');
    notify('已確認付款分配 '+money(data.allocated_cents));
    await refresh();
   }catch{notify('分配失敗：可能是超過課程未結清金額，或管理權／款項狀態已改變。')}
   finally{writing=false;render()}
   return true;
  }
  if(btn.dataset.v5BillingAction!=='confirm')return true;
  const id=btn.dataset.id;
  if(!(overview.pending_rows||[]).some(r=>r.lesson_id===id))return true;
  const rate=$('v5-billing-pending')?.querySelector(
   '[data-v5-billing-rate-for="'+id+'"]');
  const twd=Number(rate?.value);
  if(!rate||rate.value.trim()===''||!Number.isSafeInteger(twd)||twd<0||twd>1000000){
   notify('請輸入 0 至 1,000,000 的整數時薪（新臺幣元）');
   return true;
  }
  if(!window.confirm('確認這堂課的應收費用？確認後不得直接覆寫，也不代表已收款。'))
   return true;
  writing=true;render();
  try{
   const {data,error:failure}=await getClient().rpc('v5_confirm_team_lesson_fee',{
    p_lesson_id:id,p_hourly_rate_cents:twd*100
   });
   if(failure||data?.status!=='confirmed')throw failure||new Error('Unconfirmed');
   notify('已確認應收 '+money(data.amount_cents)+'（尚未收款）');
   await refresh();
  }catch{
   notify('無法確認費用，請檢查管理權、課程狀態與是否已入帳');
  }finally{writing=false;render()}
  return true;
 }
 return {render,refresh,clear:reset,handleClick,handleSubmit};
}
