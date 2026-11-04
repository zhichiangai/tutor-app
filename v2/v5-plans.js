// V5.1: read-only plan and cumulative quota display.
// Plan changes are ONLY allowed through privileged audited backend operations.
const PLAN_TEXT={
 free:{name:'Free',price:'免費',student:3,teacher:1},
 pro:{name:'Pro',price:'NT$99／月',student:30,teacher:1},
 team:{name:'Team',price:'NT$399／月',student:100,teacher:10}
};
const safeNumber=value=>{
 const n=Number(value);
 return Number.isSafeInteger(n)&&n>=0?n:0;
};
export function createV5PlanUI({getClient,getUser,getRole,isReady}){
 let generation=0,owner='',data=null,status='idle';
 const $=id=>document.getElementById(id);
 function clear(){
  generation++;owner='';data=null;status='idle';
  const content=$('v5-plan-content');
  if(content)content.replaceChildren();
  const card=$('v5-plan-card');
  if(card)card.classList.add('hidden');
 }
 function render(){
  const card=$('v5-plan-card'),root=$('v5-plan-content');
  if(!card||!root)return;
  const show=Boolean(isReady()&&getUser()?.id&&getRole()==='teacher');
  card.classList.toggle('hidden',!show);
  if(!show){root.replaceChildren();return}
  if(status==='loading'&&!data){
   root.textContent='正在讀取會員方案及名額…';
   return;
  }
  if(status==='unavailable'){
   root.textContent='V5 方案資料尚未啟用，現有課程與帳務可繼續使用。';
   return;
  }
  if(status==='error'){
   root.textContent='暫時無法讀取名額，請重新進入設定頁再試。';
   return;
  }
  if(!data){
   root.textContent='建立家教空間後，即可查看方案與學生名額。';
   return;
  }
  const plan=PLAN_TEXT[data.plan];
  if(!plan){root.textContent='方案設定未完成，請聯絡管理員。';return}
  const used=safeNumber(data.student_used),limit=safeNumber(data.student_limit);
  const teacherUsed=safeNumber(data.teacher_used),teacherLimit=safeNumber(data.teacher_limit);
  root.replaceChildren();
  const summary=document.createElement('div');
  summary.className='v5-plan-summary';
  const strong=document.createElement('strong');
  strong.textContent='目前方案：'+plan.name+' · '+plan.price;
  const student=document.createElement('p');
  student.textContent='累計學生 '+used+'／'+limit+' 人';
  const teachers=document.createElement('p');
  teachers.textContent='老師席次 '+teacherUsed+'／'+teacherLimit+' 位（包含管理者）';
  const note=document.createElement('p');
  note.className='section-sub';
  note.textContent=used>=limit?
   '學生名額已滿，歷史課程仍可查看；刪除學生也不會釋放已使用名額，新增學生需調整方案或名額。':
   '歷史學生也計入名額。刪除學生不會釋放已使用名額。';
  summary.append(strong,student,teachers,note);
  root.append(summary);

  const options=document.createElement('div');
  options.className='v5-plan-options';
  for(const [key,item] of Object.entries(PLAN_TEXT)){
   const cardEl=document.createElement('div');
   cardEl.className='v5-plan-option'+(key===data.plan?' current':'');
   const head=document.createElement('strong');
   head.textContent=item.name+(key===data.plan?' · 目前使用':'');
   const price=document.createElement('span');
   price.textContent=item.price;
   const limits=document.createElement('small');
   limits.textContent='累計學生 '+item.student+' 人 · 老師 '+item.teacher+' 位';
   const availability=document.createElement('small');
   availability.textContent=key==='free'?'免費開放': '即將推出，暫不提供線上購買';
   cardEl.append(head,price,limits,availability);
   options.append(cardEl);
  }
  root.append(options);
  const footer=document.createElement('p');
  footer.className='helper-note';
  footer.textContent='Pro／Team 正式金流尚未開放。需要測試授權或增加名額，請聯絡管理員。';
  root.append(footer);
 }
 async function refresh(){
  const id=getUser()?.id;
  const turn=++generation;
  if(!isReady()||!id||getRole()!=='teacher'){clear();return}
  if(owner!==id){owner=id;data=null}
  status='loading';render();
  const client=getClient();
  if(!client){status='unavailable';render();return}
  try{
   const {data:result,error}=await client.rpc('v5_my_plan');
   if(turn!==generation||getUser()?.id!==id||!isReady())return;
   if(error){
    status=/PGRST202|404|Could not find the function/i.test(error.message||'')?
     'unavailable':'error';
    data=null;
   }else{
    data=result&&typeof result==='object'?result:null;
    status='ready';
   }
  }catch{
   if(turn!==generation||getUser()?.id!==id||!isReady())return;
   status='error';data=null;
  }
  render();
 }
 return {render,refresh,clear};
}
