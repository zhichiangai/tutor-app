// V5.6 Team adjustments UI (manager-authorized RPCs, no direct private-table access).
// Never assumes that a browser click proves a bank payout.
export function createV56AdjustmentsUI({getClient,notify,refresh}){
 const $=id=>document.getElementById(id);
 const node=(tag,text,klass)=>{
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=String(text??'');
  if(klass)n.className=klass;
  return n;
 };
 const money=value=>{
  if(!Number.isSafeInteger(value)||value<0)return '金額不可用';
  return new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',
   minimumFractionDigits:0,maximumFractionDigits:2}).format(value/100);
 };
 const cents=text=>{
  const value=String(text??'').trim();
  if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value))return null;
  const result=Math.round(Number(value)*100);
  return Number.isSafeInteger(result)?result:null;
 };
 const methodLabels={cash:'現金',bank_transfer:'銀行轉帳',other:'其他'};
 let state=null,busy=false;
 const keys=new Map();
 function reset(){
  state=null;busy=false;keys.clear();
  $('v56-adjustments-panel')?.classList.add('hidden');
  $('v56-adjustments-message')?.replaceChildren();
  $('v56-adjustments-payments')?.replaceChildren();
  $('v56-adjustments-credits')?.replaceChildren();
  $('v56-adjustments-history')?.replaceChildren();
 }
 function button(label,action,id){
  const b=node('button',label,'secondary-button');
  b.type='button';b.disabled=busy;
  b.dataset.v56Action=action;b.dataset.id=id;return b;
 }
 function labelRow(content){
  const r=node('div',undefined,'v5-billing-row');
  r.append(node('strong',content));return r;
 }
 function render(next){
  if(next)state=next;
  const panel=$('v56-adjustments-panel');
  if(!panel)return;
  const allowed=state?.allowed&&state.teamId&&state.adjustments?.team_id===state.teamId&&
   state.adjustments?.month===state.month&&state.adjustments?.currency==='TWD'&&
   state.paymentOverview&&state.paymentOverview.team_id===state.teamId;
  panel.classList.toggle('hidden',!state?.allowed);
  const message=$('v56-adjustments-message'),
   payments=$('v56-adjustments-payments'),credits=$('v56-adjustments-credits'),
   history=$('v56-adjustments-history');
  payments.replaceChildren();credits.replaceChildren();history.replaceChildren();
  if(!allowed){
   message.textContent=state?.allowed?
    '更正與退款後端尚未啟用或資料無法核對，因此操作入口暫停。': '';
   return;
  }
  const data=state.adjustments;
  const validShape=data.refunds_bank_verified===false&&
   ['pending_voids','corrections','refunds'].every(k=>Array.isArray(data[k]))&&
   Array.isArray(state.directRequests?.requests)&&
   Array.isArray(state.appliedAdjustments?.requests)&&
   Array.isArray(state.refundable?.direct_allocations)&&
   Array.isArray(state.refundable?.advance_applications)&&
   state.conservation?.conservation_passed===true&&
   state.conservation?.bank_verified===false;
  if(!validShape||!state.safetyPassed){
   message.textContent=!state.safetyPassed?
    '帳務摘要與明細尚未通過一致性核對，已禁止更正、沖銷與退款操作。':
    '帳務更正紀錄格式異常，請停止操作並交由管理者核對。';
   return;
  }
  message.textContent='僅現任 Team 管理者可操作。已確認付款保留原始紀錄；人工退款不代表銀行已核驗。';
  const paymentsList=Array.isArray(state.paymentOverview.payments)?
   state.paymentOverview.payments:[];
  for(const p of paymentsList){
   if(!p.payment_id||!p.student_id||!Number.isSafeInteger(p.amount_cents))continue;
   const row=labelRow((p.student_name||'學生')+' · '+money(p.amount_cents)+
    ' · '+(p.status==='pending'?'待確認':p.status==='void'?'已沖銷':'已確認'));
   row.append(node('span',p.received_on+' · '+(methodLabels[p.method]||'其他'),
    'section-sub'));
   if(p.status==='pending')row.append(button('沖銷這筆待確認付款','void',p.payment_id));
   if(p.status==='confirmed'){
    row.append(button('更正付款方式','correct-method',p.payment_id));
    row.append(button('更正備註','correct-note',p.payment_id));
   }
   payments.append(row);
  }
  for(const a of state.refundable.direct_allocations){
   if(!a.payment_id||!a.lesson_id||!Number.isSafeInteger(a.remaining_cents)||
    a.remaining_cents<=0)continue;
   const row=labelRow('可申請直接付款退款 · '+String(a.subject||'課程')+
    ' · 尚可調整 '+money(a.remaining_cents));
   row.append(button('申請此課程已分配付款退款','direct-request',
    a.payment_id+':'+a.lesson_id));
   payments.append(row);
  }
  if(!payments.children.length)
   payments.append(node('p','本月無可更正、沖銷或退款的人工付款。','section-sub'));
  const balances=Array.isArray(state.advanceOverview?.credits)?
   state.advanceOverview.credits:[];
  for(const c of balances){
   if(!c.credit_id||!Number.isSafeInteger(c.available_cents))continue;
   const row=labelRow('預收款 '+c.credit_id.slice(-8)+' · 可用 '+money(c.available_cents));
   row.append(node('span','已預留退款 '+
    money(c.refund_reserved_cents??0)+'；退款只可動用尚未抵扣的餘額。','section-sub'));
   if(c.available_cents>0)
    row.append(button('申請退還此筆預收款','refund-request',c.credit_id));
   credits.append(row);
  }
  for(const a of state.refundable.advance_applications){
   if(!a.credit_id||!a.operation_id||!a.lesson_id||
    !Number.isSafeInteger(a.remaining_cents)||a.remaining_cents<=0)continue;
   const row=labelRow('已抵扣預收款 · '+String(a.subject||'課程')+
    ' · 可調整 '+money(a.remaining_cents));
   const key=a.credit_id+':'+a.operation_id+':'+a.lesson_id;
   row.append(button('撤銷抵扣並恢復預收','applied-restore-request',key));
   row.append(button('撤銷抵扣並申請退款','applied-refund-request',key));
   credits.append(row);
  }
  if(!credits.children.length)
   credits.append(node('p','目前選取的學生沒有可調整的預收餘額或抵扣紀錄。','section-sub'));
  for(const v of data.pending_voids){
   const row=labelRow('待確認付款沖銷 · '+String(v.payment_id||'').slice(-8));
   row.append(node('span',String(v.reason??''),'section-sub'));history.append(row);
  }
  for(const v of data.corrections){
   const row=labelRow('付款更正 · '+(v.field==='note'?'備註':'方式')+
    ' · '+String(v.payment_id||'').slice(-8));
   row.append(node('span',String(v.previous??'')+' → '+String(v.new??''),'section-sub'));
   row.append(node('span',String(v.reason??''),'section-sub'));history.append(row);
  }
  for(const v of data.refunds){
   if(!v.request_id)continue;
   const row=labelRow('預收款退款 '+money(v.amount_cents)+' · '+({
    requested:'待審核',approved:'已核准，待人工付款',rejected:'已拒絕',
    manual_paid:'管理者登記已付款（非銀行驗證）'
   }[v.status]||'狀態待核對'));
   if(v.status==='requested'){
    row.append(button('核准預留退款','approve',v.request_id));
    row.append(button('拒絕退款申請','reject',v.request_id));
   }
   if(v.status==='approved')row.append(button('登記人工退款已完成','manual-paid',v.request_id));
   history.append(row);
  }
  for(const v of state.directRequests.requests){
   if(!v.request_id||!Number.isSafeInteger(v.amount_cents))continue;
   const stateLabel={
    requested_no_settlement:'待審核（未動帳）',
    approved_reversed_pending_manual_payout:'已核准沖帳（尚未實際退款）',
    rejected:'已拒絕',
    manual_paid_not_bank_verified:'已登記人工退款（銀行未驗證）'
   }[v.status]||'需核對狀態';
   const row=labelRow('已分配付款退款 '+money(v.amount_cents)+' · '+stateLabel);
   if(v.status==='requested_no_settlement'){
    row.append(button('核准並反向沖帳','direct-approve',v.request_id));
    row.append(button('拒絕','direct-reject',v.request_id));
   }
   if(v.status==='approved_reversed_pending_manual_payout')
    row.append(button('登記人工退款完成','allocated-direct-manual-paid',v.request_id));
   history.append(row);
  }
  for(const v of state.appliedAdjustments.requests){
   if(!v.request_id||!Number.isSafeInteger(v.amount_cents))continue;
   const title=v.mode==='refund_reserved'?'已抵扣預收款退款':'恢復預收抵扣';
   const row=labelRow(title+' '+money(v.amount_cents)+' · '+({
    requested:'待審核',rejected:'已拒絕',
    approved_restored_credit:'已核准，恢復可用預收',
    approved_refund_reserved:'已核准，退款額度保留',
    manual_paid_not_bank_verified:'已登記人工退款（銀行未驗證）'
   }[v.status]||'需核對狀態'));
   if(v.status==='requested'){
    row.append(button('核准調整','applied-approve',v.request_id));
    row.append(button('拒絕','applied-reject',v.request_id));
   }
   if(v.status==='approved_refund_reserved')
    row.append(button('登記人工退款完成','allocated-applied-manual-paid',v.request_id));
   history.append(row);
  }
  if(!history.children.length)
   history.append(node('p','本月份尚無沖銷、更正或退款紀錄。','section-sub'));
 }
 const promptReason=label=>{
  const reason=window.prompt(label+'\n請輸入 8 至 250 字的操作原因（取消不執行）。');
  if(reason===null)return null;
  if(reason.trim().length<8||reason.length>250){
   notify('操作原因至少 8 字，最多 250 字。');return null;
  }
  return reason.trim();
 };
 const keyFor=(kind,id,payload)=>{
  const signature=kind+':'+id+':'+payload;
  if(!keys.has(signature))keys.set(signature,'v56-'+crypto.randomUUID());
  return {signature,key:keys.get(signature)};
 };
 async function handleClick(target){
  const btn=target?.closest?.('[data-v56-action]');
  if(!btn)return false;
  if(!state?.allowed||!state.safetyPassed||busy||
   !state.adjustments||!state.teamId)return true;
  const action=btn.dataset.v56Action,id=btn.dataset.id;
  const payments=(state.paymentOverview?.payments||[]);
  const credits=(state.advanceOverview?.credits||[]);
  const requests=(state.adjustments.refunds||[]);
  const directRequests=state.directRequests?.requests||[];
  const appliedRequests=state.appliedAdjustments?.requests||[];
  let rpc='',args=null,signature='',success='';
  if(action==='void'){
   const p=payments.find(p=>p.payment_id===id&&p.status==='pending');
   if(!p)return true;
   const reason=promptReason('沖銷待確認人工付款 '+money(p.amount_cents));
   if(!reason)return true;
   if(!window.confirm('只沖銷待確認付款；原始紀錄將永久保留。確定？'))return true;
   const op=keyFor(action,id,reason);signature=op.signature;
   rpc='v56_void_team_pending_payment';
   args={p_payment_id:id,p_idempotency_key:op.key,p_reason:reason};
   success='待確認付款已沖銷，原始紀錄保留';
  }else if(action==='correct-note'||action==='correct-method'){
   const p=payments.find(p=>p.payment_id===id&&p.status==='confirmed');
   if(!p)return true;
   const field=action==='correct-note'?'note':'method';
   const updated=window.prompt(field==='note'?
    '輸入更正後的付款備註（最多 250 字）':
    '輸入更正後的付款方式：cash、bank_transfer 或 other',
    field==='note'?String(p.note??''):p.method);
   if(updated===null)return true;
   if((field==='note'&&updated.length>250)||
     (field==='method'&&!['cash','bank_transfer','other'].includes(updated))){
    notify('付款更正內容不符合格式。');return true;
   }
   const reason=promptReason('追加付款更正稽核紀錄，不覆寫原始入帳');
   if(!reason)return true;
   if(!window.confirm('確認追加更正紀錄？原始付款金額及分配均不改變。'))return true;
   const op=keyFor(action,id,updated+':'+reason);signature=op.signature;
   rpc='v56_correct_team_payment_metadata';
   args={p_payment_id:id,p_field:field,p_new_value:updated,p_reason:reason,
    p_idempotency_key:op.key};
   success='更正歷史已建立，原始付款不變';
  }else if(action==='direct-request'||action==='applied-restore-request'||action==='applied-refund-request'){
   const direct=action==='direct-request';
   const source=direct?
    (state.refundable.direct_allocations||[]).find(a=>a.payment_id+':'+a.lesson_id===id):
    (state.refundable.advance_applications||[]).find(a=>a.credit_id+':'+a.operation_id+':'+a.lesson_id===id);
   if(!source||!Number.isSafeInteger(source.remaining_cents)||source.remaining_cents<1)return true;
   const entry=window.prompt('此筆可調整 '+money(source.remaining_cents)+
    '\n請輸入申請金額（新臺幣元，尚未核准或付款）。');
   if(entry===null)return true;
   const amount=cents(entry);
   if(amount===null||amount<1||amount>source.remaining_cents){
    notify('金額不可超過原始可調整分配。');return true;
   }
   const reason=promptReason('請說明反向調整原因');
   if(!reason)return true;
   const mode=action==='applied-restore-request'?'restore_credit':'refund_reserved';
   if(!window.confirm('只建立調整申請，須另行核准。確定申請 '+money(amount)+'？'))return true;
   const op=keyFor(action,id,String(amount)+':'+mode+':'+reason);signature=op.signature;
   if(direct){
    rpc='v56_request_team_direct_refund';
    args={p_payment_id:source.payment_id,
     p_allocations:[{lesson_id:source.lesson_id,amount_cents:amount}],
     p_idempotency_key:op.key,p_reason:reason};
   }else{
    rpc='v56_request_team_applied_credit_adjustment';
    args={p_credit_id:source.credit_id,
     p_entries:[{operation_id:source.operation_id,lesson_id:source.lesson_id,amount_cents:amount}],
     p_mode:mode,p_idempotency_key:op.key,p_reason:reason};
   }
   success='已建立調整申請（不代表已退款或已沖帳）';
  }else if(action==='refund-request'){
   const credit=credits.find(c=>c.credit_id===id&&c.available_cents>0);
   if(!credit)return true;
   const text=window.prompt('預收款可用 '+money(credit.available_cents)+
    '\n請輸入擬退還金額（新臺幣元，尚未實際退款）。');
   if(text===null)return true;
   const amount=cents(text);
   if(amount===null||amount<1||amount>credit.available_cents){
    notify('退款金額必須大於零且不可超過未抵扣餘額。');return true;
   }
   const reason=promptReason('申請預收款退款（不會操作銀行）');
   if(!reason)return true;
   if(!window.confirm('建立退款申請 '+money(amount)+'？本步不付款，仍須管理者核准。'))return true;
   const op=keyFor(action,id,String(amount)+':'+reason);signature=op.signature;
   rpc='v56_request_team_credit_refund';
   args={p_credit_id:id,p_amount_cents:amount,p_idempotency_key:op.key,p_reason:reason};
   success='已建立退款申請；尚未核准或付款';
  }else if(['direct-approve','direct-reject','applied-approve','applied-reject'].includes(action)){
   const direct=action.startsWith('direct-');
   const req=direct?
    directRequests.find(r=>r.request_id===id&&r.status==='requested_no_settlement'):
    appliedRequests.find(r=>r.request_id===id&&r.status==='requested');
   if(!req)return true;
   const approve=action.endsWith('approve');
   const reason=promptReason(approve?'核准反向帳務調整':'拒絕調整');
   if(!reason)return true;
   if(!window.confirm(approve?
    '此操作會建立不可改寫的反向帳務分錄，但不會操作銀行。確定？':
    '此拒絕將永久記錄，確定？'))return true;
   rpc=direct?'v56_decide_team_direct_refund':'v56_decide_team_applied_credit_adjustment';
   args={p_request_id:id,p_approve:approve,p_reason:reason};
   success=approve?'已核准反向帳務，請留意人工退款尚未支付':'退款調整申請已拒絕';
  }else if(action==='allocated-direct-manual-paid'||action==='allocated-applied-manual-paid'){
   const direct=action==='allocated-direct-manual-paid';
   const req=direct?directRequests.find(r=>r.request_id===id&&
    r.status==='approved_reversed_pending_manual_payout'):
    appliedRequests.find(r=>r.request_id===id&&r.status==='approved_refund_reserved');
   if(!req)return true;
   const reference=window.prompt('僅輸入人工退款憑證識別碼（8 至 80 字，不可填完整銀行帳號）。');
   if(reference===null)return true;
   if(reference.length<8||reference.length>80){
    notify('退款憑證識別碼格式不正確。');return true;
   }
   const date=window.prompt('請輸入外部退款日期（YYYY-MM-DD）。');
   if(date===null)return true;
   if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)){
    notify('日期格式不正確。');return true;
   }
   const reason=promptReason('聲明已在系統外完成退款（銀行尚未核驗）');
   if(!reason)return true;
   if(!window.confirm('是否確實已在系統外退還 '+money(req.amount_cents)+
    '？系統只儲存你的聲明，不能驗證銀行。'))return true;
   rpc='v56_record_allocated_refund_manual_paid';
   args={p_source:direct?'direct':'applied_credit',p_request_id:id,
    p_reference:reference,p_paid_on:date,p_reason:reason};
   success='已記錄人工退款聲明，銀行未驗證';
  }else if(action==='approve'||action==='reject'){
   const req=requests.find(r=>r.request_id===id&&r.status==='requested');
   if(!req)return true;
   const reason=promptReason(action==='approve'?'核准預留退款':'拒絕退款申請');
   if(!reason)return true;
   if(!window.confirm(action==='approve'?
    '核准後預留 '+money(req.amount_cents)+'，不可再用於課程抵扣；仍不會自動匯款。確定？':
    '拒絕此退款申請？拒絕後不可直接撤回。'))return true;
   rpc='v56_decide_team_credit_refund';
   args={p_request_id:id,p_approve:action==='approve',p_reason:reason};
   success=action==='approve'?'退款已核准並預留款額（尚未匯款）':'退款申請已拒絕';
  }else if(action==='manual-paid'){
   const req=requests.find(r=>r.request_id===id&&r.status==='approved');
   if(!req)return true;
   const reference=window.prompt('請輸入人工付款憑證末碼或識別碼（8 至 80 字，勿填完整銀行帳號）。');
   if(reference===null)return true;
   if(reference.length<8||reference.length>80){
    notify('人工付款識別碼長度須介於 8 至 80 字。');return true;
   }
   const date=window.prompt('請輸入實際人工退款日期（YYYY-MM-DD）。');
   if(date===null)return true;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    notify('退款日期格式不正確。');return true;
   }
   const reason=promptReason('確認人工退款已由管理者實際完成（不代表銀行系統驗證）');
   if(!reason)return true;
   if(!window.confirm('你是否已在系統外實際退還 '+money(req.amount_cents)+
    '？此操作只登記聲明，系統沒有銀行核驗。'))return true;
   rpc='v56_record_team_refund_manual_paid';
   args={p_request_id:id,p_reference:reference,p_paid_on:date,p_reason:reason};
   success='已記錄管理者的人工退款聲明；銀行未驗證';
  }else return true;
  busy=true;render();
  try{
   const {data,error}=await getClient().rpc(rpc,args);
   if(error||!data||data.status===undefined)
    throw error||new Error('RPC status missing');
   if(signature)keys.delete(signature);
   notify(success);
   await refresh();
  }catch{
   notify('帳務操作結果未確認。請先查看稽核紀錄，避免重複提交；重試相同輸入會沿用操作碼。');
  }finally{busy=false;render()}
  return true;
 }
 return {reset,render,handleClick};
}
