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
 let availableTeams=[],teamId='',overview=null;
 const today=new Date();
 let month=new Date(today.getFullYear(),today.getMonth(),1);
 const valid=()=>!!(isReady()&&getRole()==='teacher'&&getUser()?.id&&getClient());
 function reset(){
  generation++;ready=false;loading=false;writing=false;error='';
  availableTeams=[];teamId='';overview=null;
  $('v5-billing-card')?.classList.add('hidden');
  for(const id of ['v5-billing-message','v5-billing-pending',
    'v5-billing-confirmed','v5-billing-total']){
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
  if(!overview)return;
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
 }
 function attach(){
  if(attached)return;attached=true;
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
  loading=true;error='';overview=null;
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
    const result=await client.rpc('v5_team_billing_overview',{
     p_team_id:teamId,p_month:first
    });
    if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
    if(result.error)throw result.error;
    overview=result.data;
   }else overview=null;
   ready=true;
  }catch{
   if(stamp!==generation||!valid()||getUser()?.id!==userId)return;
   overview=null;error='Team 帳務暫時無法讀取，請重新進入設定頁。';
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
 return {render,refresh,clear:reset,handleClick};
}
