// RAP-49: Team student identity is granted only by verified server-side
// invitation acceptance. This module never reads private fees or teacher notes.
export function createV5TeamStudentAuthUI({
  getClient,getUser,getContext,isReady,notify,onAccepted
}){
 let generation=0,owner='',loading=false,busy=false,error='',supported=true;
 let invitations=[],links=[],lessons=[];
 let manager={students:[],pending:[],links:[]};
 const $=id=>document.getElementById(id);
 const el=(tag,value,className)=>{
  const element=document.createElement(tag);
  if(value!==undefined)element.textContent=String(value??'');
  if(className)element.className=className;
  return element;
 };
 const current=()=>Boolean(getClient()&&getUser()?.id&&isReady());
 const unchanged=(id,stamp)=>stamp===generation&&getUser()?.id===id&&current();
 const asRows=value=>Array.isArray(value)?value:[];
 const missing=error=>['PGRST202','42883','42P01'].includes(error?.code)||
  /could not find.*function|does not exist/i.test(error?.message||'');
 const dateLabel=value=>{
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '日期未提供';
  return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',
   month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
  }).format(date);
 };
 async function rpc(name,args){
  const {data,error:failure}=await getClient().rpc(name,args);
  if(failure)throw failure;
  return data;
 }
 function clear(){
  generation++;owner='';loading=false;busy=false;error='';supported=true;
  invitations=[];links=[];lessons=[];manager={students:[],pending:[],links:[]};
  for(const id of ['v5-student-auth-invitations','v5-student-auth-links',
   'v5-student-auth-admin-students','v5-student-auth-admin-pending',
   'v5-student-auth-admin-links','v5-team-student-lesson-list',
   'v5-team-student-today-list','v5-team-student-calendar-list']){
   $(id)?.replaceChildren();
  }
  for(const id of ['v5-student-auth-card','v5-student-auth-admin-card',
   'v5-team-student-learning-card','v5-team-student-today-card',
   'v5-team-student-calendar-card'])$(id)?.classList.add('hidden');
 }
 // Used during account bootstrap, before the UI is ready, so an existing
 // verified Team student is offered student mode without any V4 link.
 async function readMyLinks(){
  if(!getUser()?.id||!getClient())return [];
  const {data,error:failure}=await getClient().rpc('v5_my_team_student_links');
  if(failure){
   if(missing(failure))return []; // Code-first rollout must not break old V4.
   throw failure;
  }
  return asRows(data);
 }
 async function refresh(){
  if(!current()){clear();return}
  const id=getUser().id,stamp=++generation;
  owner=id;loading=true;error='';render();
  try{
   const results=await Promise.all([
    rpc('v5_my_team_student_invitations'),
    rpc('v5_my_team_student_links'),
    rpc('v5_my_team_student_lessons'),
    rpc('v5_team_student_manager_overview')
   ]);
   if(!unchanged(id,stamp))return;
   invitations=asRows(results[0]);links=asRows(results[1]);lessons=asRows(results[2]);
   const info=results[3]||{};
   manager={students:asRows(info.students),pending:asRows(info.pending),
    links:asRows(info.links)};
   supported=true;
  }catch(failure){
   if(!unchanged(id,stamp))return;
   invitations=[];links=[];lessons=[];
   manager={students:[],pending:[],links:[]};
   supported=!missing(failure);
   error=supported?'Team 學生資料暫時無法讀取，請重新整理後再試':'';
  }finally{
   if(unchanged(id,stamp)){loading=false;render()}
  }
 }
 const addItem=(parent,header,detail,action,label,id)=>{
  const row=el('div',undefined,'v5-team-student-row');
  const body=el('div');
  body.append(el('strong',header));
  if(detail)body.append(el('small',detail));
  row.append(body);
  if(action){
   const button=el('button',label,'secondary-button');
   button.type='button';
   button.dataset.v5StudentAction=action;
   button.dataset.id=id;
   button.disabled=busy;
   row.append(button);
  }
  parent.append(row);
 };
 function render(){
  const ctx=getContext(),signed=current()&&owner===getUser()?.id;
  const account=$('v5-student-auth-card'),admin=$('v5-student-auth-admin-card');
  const studentLearning=$('v5-team-student-learning-card');
  const studentToday=$('v5-team-student-today-card');
  const studentCalendar=$('v5-team-student-calendar-card');
  if(!account||!admin||!studentLearning||!studentToday||!studentCalendar)return;
  const hasState=signed&&supported&&!error;
  const viewSettings=ctx.view==='settings';
  const teacherAdmin=hasState&&ctx.role==='teacher'&&ctx.workspaceMode==='team'&&
   ctx.teamSection==='learning'&&manager.students.length>0;
  const studentMode=hasState&&ctx.role==='student'&&links.length>0;
  account.classList.toggle('hidden',!(hasState&&viewSettings&&
   (invitations.length>0||links.length>0)));
  admin.classList.toggle('hidden',!teacherAdmin);
  studentLearning.classList.toggle('hidden',!(studentMode&&ctx.view==='student-learning'));
  studentToday.classList.toggle('hidden',!(studentMode&&ctx.view==='student-today'));
  studentCalendar.classList.toggle('hidden',!(studentMode&&ctx.view==='student-calendar'));
  const pending=$('v5-student-auth-invitations'),connected=$('v5-student-auth-links');
  pending.replaceChildren();connected.replaceChildren();
  for(const invite of invitations){
   addItem(pending,'來自 '+invite.team_name+' 的學習邀請',
    invite.student_name+' · 截止 '+dateLabel(invite.expires_at),
    'accept','接受邀請',invite.id);
  }
  for(const link of links)addItem(connected,
   link.team_name+' · '+link.student_name,'已連結，僅顯示你的課程');
  const studentSelect=$('v5-student-auth-admin-select');
  const previous=studentSelect.value;
  studentSelect.replaceChildren();
  for(const st of manager.students){
   const opt=el('option',st.team_name+' · '+st.name);
   opt.value=st.id;studentSelect.append(opt);
  }
  if(manager.students.some(st=>st.id===previous))studentSelect.value=previous;
  const adminPending=$('v5-student-auth-admin-pending');
  adminPending.replaceChildren();
  for(const p of manager.pending)addItem(adminPending,
   p.team_name+' · '+p.student_name,
   '邀請已送出 · '+p.recipient_email+' · '+dateLabel(p.expires_at),
   'cancel','取消邀請',p.id);
  const adminLinked=$('v5-student-auth-admin-links');
  adminLinked.replaceChildren();
  for(const link of manager.links)addItem(adminLinked,
   link.team_name+' · '+link.student_name,
   '已完成學生本人驗證的帳號連結','revoke','解除連結',link.id);
  const list=$('v5-team-student-lesson-list');
  const today=$('v5-team-student-today-list');
  const calendar=$('v5-team-student-calendar-list');
  for(const target of [list,today,calendar])target.replaceChildren();
  for(const lesson of lessons){
   const header=lesson.subject+' · '+lesson.project_name;
   const detail=dateLabel(lesson.lesson_start)+' 至 '+dateLabel(lesson.lesson_end)+
    ' · '+(lesson.status==='completed'?'已完成':lesson.status==='cancelled'?'已取消':'已安排');
   addItem(list,header,detail);
   addItem(calendar,header,detail);
  }
  const upcoming=lessons.filter(l=>l.status==='scheduled'&&
   new Date(l.lesson_end)>new Date()).sort((a,b)=>
    new Date(a.lesson_start)-new Date(b.lesson_start))[0];
  const latest=lessons.find(l=>l.status==='completed');
  if(upcoming)addItem(today,'下一堂課：'+upcoming.subject,dateLabel(upcoming.lesson_start));
  if(latest)addItem(today,'最近完成：'+latest.subject,dateLabel(latest.lesson_start));
  if(!upcoming&&!latest)today.append(el('p','目前沒有 Team 課程。','section-sub'));
  if(!lessons.length){
   list.append(el('p','目前沒有可查看的 Team 課程。','section-sub'));
   calendar.append(el('p','目前沒有可查看的 Team 課程。','section-sub'));
  }
  const refreshBtn=$('v5-student-auth-refresh');
  if(refreshBtn)refreshBtn.disabled=busy||loading;
  const submit=$('v5-team-student-invite-submit');
  if(submit)submit.disabled=busy||!manager.students.length;
 }
 async function mutate(name,args,success){
  if(!current()||busy)return false;
  busy=true;render();
  try{
   await rpc(name,args);
   notify(success);
   await refresh();
   return true;
  }catch{
   notify('操作未完成，請檢查帳號、邀請狀態及 Team 權限');
   return false;
  }finally{busy=false;render()}
 }
 async function handleSubmit(ev){
  if(ev.target?.id!=='v5-team-student-invite-form')return false;
  ev.preventDefault();
  const selected=$('v5-student-auth-admin-select').value;
  const email=$('v5-student-auth-admin-email').value.trim().toLowerCase();
  if(!manager.students.some(st=>st.id===selected)||!email||email.length>254)return true;
  const ok=await mutate('v5_invite_team_student',
   {p_student_id:selected,p_recipient_email:email},
   'Team 學生邀請已送出，等待學生本人接受');
  if(ok)$('v5-student-auth-admin-email').value='';
  return true;
 }
 async function handleClick(target){
  const button=target?.closest?.('[data-v5-student-action]');
  if(!button)return false;
  const action=button.dataset.v5StudentAction,id=button.dataset.id;
  if(action==='refresh'){await refresh();return true}
  if(!id)return true;
  if(action==='accept'){
   const ok=await mutate('v5_accept_team_student_invitation',
    {p_invitation_id:id},'已連結你的 Team 學習資料');
   if(ok)await onAccepted?.();
  }
  if(action==='cancel'&&window.confirm('確定取消此 Team 學生邀請？'))
   await mutate('v5_revoke_team_student_invitation',
    {p_invitation_id:id},'已取消邀請');
  if(action==='revoke'&&window.confirm('確定解除此學生的 Team 登入連結？學生將立即無法再讀取 Team 課程。'))
   await mutate('v5_revoke_team_student_link',
    {p_link_id:id},'已解除 Team 學生連結');
  return true;
 }
 return {clear,refresh,render,readMyLinks,handleSubmit,handleClick};
}
