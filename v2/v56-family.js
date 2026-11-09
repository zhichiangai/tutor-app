// Family-specific Team finance. V4 guardian relationship is rechecked by
// backend on EVERY read; this UI never infers Team student IDs from V4 IDs.
export function createV56FamilyUI({getClient,getUser,getRole,isReady,notify}){
 const $=id=>document.getElementById(id);
 const node=(tag,text,klass)=>{
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=String(text??'');
  if(klass)n.className=klass;
  return n;
 };
 const money=v=>Number.isSafeInteger(v)&&v>=0?
  new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',
   minimumFractionDigits:0,maximumFractionDigits:2}).format(v/100):'金額不可用';
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1);
 let loading=false,loaded=false,attempted=false,error='',proposals=[],statements=[];
 let serial=0,userId='';
 const valid=()=>isReady()&&getRole()==='parent'&&!!getUser()?.id&&!!getClient();
 const monthKey=()=>[month.getFullYear(),String(month.getMonth()+1).padStart(2,'0'),'01'].join('-');
 function clear(){
  serial++;loaded=false;attempted=false;loading=false;error='';
  proposals=[];statements=[];userId='';
  $('v56-parent-family-panel')?.classList.add('hidden');
  $('v56-parent-family-content')?.replaceChildren();
 }
 function action(label,kind,id){
  const b=node('button',label,'secondary-button');
  b.type='button';b.dataset.v56FamilyAction=kind;b.dataset.id=id;return b;
 }
 function render(){
  const panel=$('v56-parent-family-panel'),content=$('v56-parent-family-content');
  if(!panel||!content)return;
  const allowed=valid();
  panel.classList.toggle('hidden',!allowed);
  if(!allowed){content.replaceChildren();return}
  const label=$('v56-parent-family-month');
  if(label)label.textContent=new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'long'}).format(month);
  content.replaceChildren();
  if(loading){content.append(node('p','正在核對 V4 家長連結及 Team 授權…','section-sub'));return}
  if(error){content.append(node('p',error,'section-sub'));return}
  if(!loaded){
   content.append(node('p','正在讀取已核准的 Team 家長資料。','section-sub'));
   if(!attempted)void refresh();
   return;
  }
  if(!proposals.length){
   content.append(node('p','目前沒有待確認或已授權的 Team 家長帳務對應。','section-sub'));
   return;
  }
  for(const p of proposals){
   if(!p.proposal_id||!p.team_id||!p.team_student_id)continue;
   const wrapper=node('div',undefined,'v5-billing-row');
   wrapper.append(node('strong',String(p.display_name||'學生')+' · '+({
    pending:'等待家長同意',accepted:'已授權',revoked:'已撤回授權'
   }[p.status]||'無法核對'));
   if(p.status==='pending')
    wrapper.append(action('同意查看這位孩子的 Team 帳務','accept',p.proposal_id));
   if(p.status==='accepted'){
    wrapper.append(action('撤回 Team 帳務查看授權','revoke',p.proposal_id));
    const statement=statements.find(x=>x.team_id===p.team_id&&x.student_id===p.team_student_id);
    if(statement&&statement.currency==='TWD'&&statement.month===monthKey()&&
     Array.isArray(statement.receivables)&&Array.isArray(statement.payments)&&
     Array.isArray(statement.correction_refund_history)){
     for(const lesson of statement.receivables){
      if(!Number.isSafeInteger(lesson.fee_cents)||!Number.isSafeInteger(lesson.outstanding_cents))continue;
      wrapper.append(node('span',String(lesson.subject||'課程')+
       ' · 應收 '+money(lesson.fee_cents)+' · 尚欠 '+money(lesson.outstanding_cents),'section-sub'));
     }
     for(const payment of statement.payments)
      wrapper.append(node('span','付款 '+String(payment.received_on||'')+
       ' · '+money(payment.amount_cents)+' · 已人工確認','section-sub'));
     for(const event of statement.correction_refund_history)
      wrapper.append(node('span','更正／退款 · '+String(event.type||'')+
       ' · '+money(event.amount_cents)+' · '+String(event.status||''),'section-sub'));
     wrapper.append(node('span','退款若標示人工已付，仍不代表銀行驗證成功。','section-sub'));
    }else wrapper.append(node('span','Team 帳務暫時無法核對；不顯示可能過期的資料。','section-sub'));
   }
   content.append(wrapper);
  }
 }
 async function refresh(){
  if(!valid()){clear();return}
  const ticket=++serial;
  userId=getUser().id;loading=true;loaded=false;attempted=true;error='';
  proposals=[];statements=[];render();
  try{
   const client=getClient();
   const {data,error:failure}=await client.rpc('v56_my_team_family_proposals');
   if(ticket!==serial||!valid()||getUser()?.id!==userId)return;
   if(failure||!Array.isArray(data?.proposals))throw failure||Error('Invalid family bridge list');
   const list=data.proposals.slice(0,20);
   if(list.some(p=>!p.proposal_id||!p.team_id||!p.team_student_id||
    !['pending','accepted','revoked'].includes(p.status)))throw Error('Invalid scoped proposals');
   const accepted=list.filter(p=>p.status==='accepted');
   const queries=await Promise.all(accepted.map(p=>client.rpc('v56_team_parent_finance_overview',{
    p_team_id:p.team_id,p_team_student_id:p.team_student_id,p_month:monthKey()
   })));
   if(ticket!==serial||!valid()||getUser()?.id!==userId)return;
   if(queries.some(q=>q.error))throw Error('Family authorisation changed');
   const records=queries.map(q=>q.data);
   if(records.some((rec,i)=>rec.team_id!==accepted[i].team_id||
    rec.student_id!==accepted[i].team_student_id||rec.month!==monthKey()||
    rec.currency!=='TWD'||rec.bank_verified!==false))throw Error('Mismatched family finance scope');
   proposals=list;statements=records;loaded=true;
  }catch{
   proposals=[];statements=[];loaded=false;
   error='Team 家長帳務尚未啟用、連結已解除，或權限暫時無法驗證；未顯示任何財務資料。';
  }finally{if(ticket===serial&&valid()&&getUser()?.id===userId){loading=false;render()}}
 }
 async function handleClick(target){
  const b=target?.closest?.('[data-v56-family-action]');
  if(!b)return false;
  if(!valid()||loading||!loaded)return true;
  const kind=b.dataset.v56FamilyAction,id=b.dataset.id;
  if(kind==='month-prev'||kind==='month-next'){
   month=new Date(month.getFullYear(),month.getMonth()+(kind==='month-prev'?-1:1),1);
   void refresh();return true;
  }
  const p=proposals.find(x=>x.proposal_id===id);
  if(!p||!(kind==='accept'&&p.status==='pending'||kind==='revoke'&&p.status==='accepted'))return true;
  if(!window.confirm(kind==='accept'?
   '同意透過目前有效的 V4 家長連結，查看這位 Team 學生的課程帳務？':
   '撤回 Team 帳務查看授權？之後將無法閱讀這段 Team 帳務。'))return true;
  // Clear all displayed financial data before any permission write.
  const actor=getUser().id;loading=true;loaded=false;proposals=[];statements=[];render();
  try{
   const {error:failure}=await getClient().rpc('v56_respond_team_family_proposal',{
    p_proposal_id:id,p_accept:kind==='accept'
   });
   if(failure)throw failure;
   notify(kind==='accept'?'已接受 Team 家長帳務對應':'已撤回 Team 帳務授權');
  }catch{notify('授權變更未確認，請重新整理後核對。')}
  if(valid()&&getUser().id===actor)void refresh();
  return true;
 }
 return {render,refresh,clear,handleClick};
}
