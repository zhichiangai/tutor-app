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
 let availableTeams=[],teamId='',overview=null,paymentOverview=null;
 let paymentReference='manual-'+crypto.randomUUID();
 const today=new Date();
 let month=new Date(today.getFullYear(),today.getMonth(),1);
 const valid=()=>!!(isReady()&&getRole()==='teacher'&&getUser()?.id&&getClient());
 function reset(){
  generation++;ready=false;loading=false;writing=false;error='';
  availableTeams=[];teamId='';overview=null;paymentOverview=null;
  paymentReference='manual-'+crypto.randomUUID();
  $('v5-billing-card')?.classList.add('hidden');
  for(const id of ['v5-billing-message','v5-billing-pending',
    'v5-billing-confirmed','v5-billing-total',
    'v5-payment-pending-reports','v5-payment-confirmed-reports',
    'v5-payment-confirmed-total','v5-payment-outstanding-total']){
   $(id)?.replaceChildren();
  }
 }
 function options(element,items){
  element.replaceChildren();
  for(const it of items){
   const opt=item('option',it.label);opt.value=it.value;element.append(opt);
  }
 }
 function render(){
  const card=$('v5-billing-card');
  if(!card)return;
  if(!valid()||(!ready&&!loading&&!error)){
   card.classList.add('hidden');return;
  }
  // Never display any amount to users without a current successful manager RPC.
  const shown=availableTeams.length>0;
  card.classList.toggle('hidden',!shown);
  if(!shown)return;
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
   for(const id of ['v5-payment-pending-reports','v5-payment-confirmed-reports']){
    $(id).replaceChildren();
   }
   $('v5-payment-confirmed-total').textContent='';
   $('v5-payment-outstanding-total').textContent='';
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
 function cents(raw){
  if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(raw).trim()))
   return null;
  const n=Math.round(Number(raw)*100);
  return Number.isSafeInteger(n)?n:null;
 }
 async function handleSubmit(e){
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
   teamId=ev.target.value;void refresh();
  });
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
    const [result,payments]=await Promise.all([
     client.rpc('v5_team_billing_overview',{
      p_team_id:teamId,p_month:first
     }),
     client.rpc('v5_team_payment_overview',{
      p_team_id:teamId,p_month:first
     })
    ]);
    if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
    if(result.error||payments.error)throw result.error||payments.error;
    overview=result.data;paymentOverview=payments.data;
   }else overview=null;
   ready=true;
  }catch{
   if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
   overview=null;paymentOverview=null;
   error='Team 帳務暫時無法讀取，請重新進入設定頁。';
  }finally{
   if(stamp===generation&&valid()&&getUser()?.id===userId){
    loading=false;render();
   }
  }
 }
 async function handleClick(target){
  const btn=target?.closest?.('[data-v5-billing-action]');
  if(!btn)return false;
  if(!valid()||!ready||writing||!overview)return true;
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
