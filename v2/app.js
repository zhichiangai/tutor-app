
/* 好好上課 V3 · GitHub Pages/Vercel + Supabase (live) / browser-only (preview).
 * Only the public Supabase URL/publishable key appear here. Never store service_role keys.
 */
import { expandSchedules, isVirtualOccurrence, findTimeConflicts, originalOccurrenceDate, matchesRecurrence } from "./scheduling.js";
import { monthAgendaMarkup, monthSummary } from "./calendar-view.js";
import { lessonAllocation, eligiblePeriodLessons, allocateOldestFirst, amount } from "./payment-ledger.js";
import { durationHours, actualDefaults, validateActual, isPaymentLocked } from "./lesson-actual.js";
const SUPABASE_URL = "https://vctisuglfoxyuwlvyjee.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QR8An_jEnMEZTPuTHebFDA_xg46FLit";
const STORAGE = "tutor_v2_preview_data_20261019";
const ROLE_STORAGE = "tutor_v2_role";
const MODE_STORAGE = "tutor_v2_mode";
const CALENDAR_MODE_STORAGE = "tutor_v22_calendar_mode";
const NAMES = ["日","一","二","三","四","五","六"];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const asText = (s) => String(s??"");
const esc = (s) => asText(s).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const money = (n) => "NT$ " + Number(n||0).toLocaleString("zh-TW",{maximumFractionDigits:0});
const num = (n) => Number(n||0);
const dateKey = (d) => {const x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
const parseDate = (s) => new Date(asText(s).slice(0,10)+"T12:00:00");
const sameMonth = (s,d) => asText(s).slice(0,7)===dateKey(d).slice(0,7);
const prettyDate = (s) => {const d=parseDate(s);return (d.getMonth()+1)+"月"+d.getDate()+"日 週"+NAMES[d.getDay()]};
const timeLabel = (s) => asText(s).slice(0,5);
const tick = ()=>new Date();
const uid = ()=>crypto.randomUUID();
let client=null, activeUser=null, loading=false, teacherPreferences={};
const state={mode:localStorage.getItem(MODE_STORAGE)==="live"?"live":"demo",role:localStorage.getItem(ROLE_STORAGE)==="parent"?"parent":"teacher",view:"home",month:new Date(new Date().getFullYear(),new Date().getMonth(),1),selected:dateKey(tick()),students:[],lessons:[],invites:[],guardians:[],requests:[],schedules:[],exceptions:[],editing:null,editingSchedule:null,changingLesson:null,calendarMode:localStorage.getItem(CALENDAR_MODE_STORAGE)==="list"?"list":"month",paymentBatches:[],paymentBatchItems:[],profiles:[],workspaces:[],workspaceMembers:[],parentTeacherFilter:"all",receiptBatch:null,activeLesson:null,actualHoursManual:false};

function seed(){
 const today=tick(), base=new Date(today.getFullYear(),today.getMonth(),1);
 const demoStudents=[
  {id:"demo-s1",name:"小明",subject:"數學",hourly_rate:500,teacher_id:"demo-teacher"},
  {id:"demo-s2",name:"小安",subject:"英文",hourly_rate:600,teacher_id:"demo-teacher"},
  {id:"demo-s3",name:"小語",subject:"理化",hourly_rate:550,teacher_id:"demo-teacher"}
 ];
 const lessons=[]; let counter=1;
 for(let i=0;i<27;i+=3){const d=new Date(base.getFullYear(),base.getMonth(),i+2);if(d.getMonth()!==base.getMonth())break;
  const st=demoStudents[(i/3)%3],passed=dateKey(d)<dateKey(today);
  lessons.push({id:"demo-l"+counter++,owner_id:"demo-teacher",student_id:st.id,student:st.name,subject:st.subject,lesson_date:dateKey(d),start_time:((i%2)?"18:00":"19:00"),end_time:((i%2)?"19:30":"20:30"),hours:1.5,hourly_rate:st.hourly_rate,total_amount:st.hourly_rate*1.5,type:passed?"lesson":"planned",status:passed?(i%4===0?"老師已收到":"未付款"):"未付款",remarks:passed?"今日複習重點觀念，進度很穩定。":"",focus_rating:4,attitude_rating:5});
 }
 const upcoming=[1,3,6].map((offset,i)=>{const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset),st=demoStudents[i];return {id:"demo-f"+i,owner_id:"demo-teacher",student_id:st.id,student:st.name,subject:st.subject,lesson_date:dateKey(d),start_time:i===0?"19:00":"18:00",end_time:i===0?"20:30":"19:30",hours:1.5,hourly_rate:st.hourly_rate,total_amount:st.hourly_rate*1.5,type:"planned",status:"未付款",remarks:""}});
 const prev=new Date(today.getFullYear(),today.getMonth()-1,23);
 const previousLesson={id:"demo-prev-unpaid",owner_id:"demo-teacher",student_id:"demo-s1",student:"小明",subject:"數學",lesson_date:dateKey(prev),start_time:"19:00",end_time:"20:30",hours:1.5,hourly_rate:500,total_amount:750,type:"lesson",status:"未付款",remarks:"跨月付款測試課程"};
 return {students:demoStudents,lessons:[...lessons,...upcoming,previousLesson],invites:[],guardians:demoStudents.map(s=>({student_id:s.id,guardian_id:"demo-parent",teacher_id:"demo-teacher"})),requests:[],
  schedules:[{id:"demo-rule-1",teacher_id:"demo-teacher",student_id:"demo-s3",subject:"理化",weekdays:[3,6],every_weeks:1,starts_on:dateKey(today),ends_on:dateKey(new Date(today.getFullYear(),today.getMonth()+3,today.getDate())),start_time:"16:00",end_time:"17:30",hourly_rate:550}],
  exceptions:[],paymentBatches:[],paymentBatchItems:[]};
}
function saveDemo(){if(state.mode==="demo")localStorage.setItem(STORAGE,JSON.stringify({students:state.students,lessons:state.lessons,invites:state.invites,guardians:state.guardians,requests:state.requests,schedules:state.schedules,exceptions:state.exceptions,paymentBatches:state.paymentBatches,paymentBatchItems:state.paymentBatchItems}))}
function loadDemo(){try{const o=JSON.parse(localStorage.getItem(STORAGE)||"null")||seed();for(const k of ["students","lessons","invites","guardians","requests","schedules","exceptions","paymentBatches","paymentBatchItems"])state[k]=Array.isArray(o[k])?o[k]:(k==="schedules"?seed().schedules:[]);}catch{Object.assign(state,seed());}saveDemo();}
function visibleStudents(){
 if(state.role==="teacher")return state.students.filter(s=>state.mode==="demo"||s.teacher_id===activeUser?.id);
 const allowed=new Set(state.guardians.filter(g=>(state.mode==="demo"||g.guardian_id===activeUser?.id)
 &&(state.mode==="demo"||state.parentTeacherFilter==="all"||g.teacher_id===state.parentTeacherFilter)).map(g=>g.student_id));
 return state.students.filter(s=>allowed.has(s.id));
}
function visibleLessons(){
 const allowed=new Set(visibleStudents().map(s=>s.id));
 const real=state.lessons.filter(l=>allowed.has(l.student_id) && (state.role==="parent"||state.mode==="demo"||l.owner_id===activeUser?.id));
 const virtual=expandSchedules({schedules:state.schedules,exceptions:state.exceptions,lessons:real,allowedStudents:[...allowed],month:state.month,today:dateKey(tick())});
 return [...real,...virtual];
}
function resolveLesson(id){return visibleLessons().find(l=>l.id===id)}
function studentFor(lesson){return state.students.find(s=>s.id===lesson.student_id)}
function isPast(s){return s<dateKey(tick())}
function typeLabel(l){return l.type==="leave"?"已請假":l.type==="planned"?"預排課程":"已上課"}
function statusLabel(l){if(l.type==="lesson"){const balance=lessonBalance(l);if(balance.pending>0&&balance.confirmed>0)return "部分已收／待確認";if(balance.pending>0)return balance.pending>=balance.total-0.005?"家長已付款":"部分付款待確認";if(balance.confirmed>0)return balance.confirmed>=balance.total-0.005?"老師已收到":"部分已收款"}return l.type==="moved"?"已改期":l.type==="leave"?(l.leave_source==="teacher"?"老師停課":"學生請假"):l.type==="planned"?"預計上課":l.status||"未付款"}
function pillClass(l){if(l.type==="lesson"){const b=lessonBalance(l);if(b.pending>0)return "pending";if(b.confirmed>=b.total-0.005&&b.total>0)return "paid"}return l.type==="moved"?"pending":l.type==="leave"?"leave":l.type==="planned"?"":l.status==="老師已收到"?"paid":l.status==="家長已付款"?"pending":""}
function lessonBalance(l){return lessonAllocation(l,state.paymentBatches,state.paymentBatchItems,state.requests)}
function lessonSum(list){return list.filter(l=>l.type==="lesson").reduce((v,l)=>v+num(l.total_amount),0)}
function monthLessons(){return visibleLessons().filter(l=>sameMonth(l.lesson_date,state.month))}
function hourTotal(list){return list.filter(l=>l.type==="lesson").reduce((v,l)=>v+num(l.hours),0)}
function toast(message){const box=$("#toast");box.textContent=message;box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,3500)}
function setBusy(yes){
 loading=yes;
 $$("button[type=submit]").forEach(el=>{
  if(yes){el.dataset.wasDisabled=el.disabled?"1":"0";el.disabled=true;}
  else{el.disabled=el.dataset.wasDisabled==="1";delete el.dataset.wasDisabled;}
 });
}
function showModal(id){const dialog=$("#"+id);if(dialog&&!dialog.open)dialog.showModal()}
function closeModal(id){const dialog=$("#"+id);if(dialog?.open)dialog.close()}
function setView(view){state.view=view;$$(".page-view").forEach(x=>x.classList.toggle("hidden",x.id!=="view-"+view));$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("#breadcrumb-name").textContent=({home:"今天",calendar:"課程月曆",billing:"收付款",students:"學生與家長"})[view];render()}
function setRole(role){
 state.role=role;
 localStorage.setItem(state.mode==="live"&&activeUser?ROLE_STORAGE+"_"+activeUser.id:ROLE_STORAGE,role);
 setView("home");toast(role==="teacher"?"已切換到老師檢視":"已切換到家長檢視");
}
function myWorkspace(){return state.mode==="live"&&activeUser?state.workspaces.find(w=>w.owner_id===activeUser.id):null}
function requireTeacherWorkspace(){
 if(state.mode==="live"&&(!activeUser||!myWorkspace())){
  toast("請先建立自己的家教空間，再新增學生或課程");
  showModal("account-modal");return false;
 }
 return true;
}
function workspaceTitle(id){return state.workspaces.find(w=>w.owner_id===id)?.name||"家教老師"}
function renderWorkspaceUI(){
 const live=state.mode==="live"&&!!activeUser, teacher=state.role==="teacher", ws=myWorkspace();
 $("#workspace-setup").classList.toggle("hidden",!(live&&teacher&&!ws));
 $("#workspace-account").classList.toggle("hidden",!live||!teacher);
 $("#workspace-create").classList.toggle("hidden",!!ws);
 $("#workspace-rename").classList.toggle("hidden",!ws);
 $("#workspace-description").textContent=ws?
  "更新家教空間名稱不會修改現有課程或家長權限。":
  "建立專屬空間後即可新增學生和課程；家長不需要建立空間。";
 if(ws&&document.activeElement!==$("#workspace-name"))$("#workspace-name").value=ws.name;
 const teachers=[...new Set(state.guardians.filter(g=>live&&g.guardian_id===activeUser.id).map(g=>g.teacher_id))];
 if(!teachers.includes(state.parentTeacherFilter))state.parentTeacherFilter="all";
 $("#parent-teacher-bar").classList.toggle("hidden",!live||teacher||teachers.length<2);
 $("#parent-teacher-select").innerHTML='<option value="all">全部老師</option>'+
  teachers.map(id=>'<option value="'+esc(id)+'">'+esc(workspaceTitle(id))+'</option>').join("");
 $("#parent-teacher-select").value=state.parentTeacherFilter;
}
async function ensureMyProfile(){
 if(!activeUser)return;
 const {data,error}=await client.from("profiles").select("id").eq("id",activeUser.id).maybeSingle();
 if(error)throw error;
 if(!data){
  const displayName=String(activeUser.user_metadata?.full_name||activeUser.user_metadata?.name||"使用者").trim().slice(0,80)||"使用者";
  const r=await client.from("profiles").insert({id:activeUser.id,display_name:displayName});
  if(r.error&&r.error.code!=="23505")throw r.error;
 }
}
async function saveMyWorkspace(rename=false){
 if(state.mode!=="live"||!activeUser||state.role!=="teacher"){toast("請先使用 Google 帳號登入老師身分");return}
 const ws=myWorkspace();
 if((rename&&!ws)||(!rename&&ws))return;
 const name=$("#workspace-name").value.trim();
 if(!name||name.length>80){toast("請輸入 1～80 字的家教空間名稱");return}
 const ok=await persist(async()=>{
  if(rename)assertResult(await client.from("workspaces").update({name}).eq("id",ws.id).select("id").single());
  else assertResult(await client.from("workspaces").insert({owner_id:activeUser.id,kind:"individual",name}).select("id").single());
 });
 if(ok){await loadTeacherPreferences();closeModal("account-modal");toast(rename?"空間名稱已更新":"家教空間已建立，現在可以新增學生")}
}
function render(){
 const role=state.role,teacher=role==="teacher";
 $("#greeting-title").innerHTML=teacher?"把每一堂課，<em>好好記下來。</em>":"每個成長時刻，<em>都值得珍惜。</em>";
 $("#greeting-copy").textContent=teacher?"從課程到收款，讓重要的小事都有自己的位置。":"孩子的上課安排、請假和付款，打開就能看見。";
 $("#top-add").style.display=teacher?"":"none";
 $("#demo-banner").classList.toggle("hidden",state.mode!=="demo");
 $("#demo-reset").classList.toggle("hidden",state.mode!=="demo");
 $("#connection-status").classList.toggle("live",state.mode==="live"&&!!activeUser);
 $("#connection-status").innerHTML=state.mode==="demo"?"<i></i> 體驗模式":activeUser?"<i></i> 已安全連線":"<i></i> 尚未登入";
 $("#account-label").textContent=activeUser?.email?activeUser.email.split("@")[0]:"預覽使用者";
 $("#account-subtitle").textContent=state.mode==="demo"?"體驗模式":
  !activeUser?"尚未登入":state.role==="teacher"?
    (myWorkspace()?.name||"尚未建立工作空間"):
    ("家長 · "+new Set(state.guardians.filter(g=>g.guardian_id===activeUser.id).map(g=>g.teacher_id)).size+" 位授權老師");
 $("#avatar").textContent=activeUser?.email?.charAt(0).toUpperCase()||"好";
 $("#account-current").textContent=activeUser?.email||"尚未使用 Google 登入";
 $("#role-teacher").classList.toggle("active",teacher);
 $("#role-parent").classList.toggle("active",!teacher);
 renderWorkspaceUI();
 const ls=monthLessons(),done=ls.filter(l=>l.type==="lesson"),pending=done.filter(l=>lessonBalance(l).confirmed < lessonBalance(l).total-0.005);
 const completed=done.filter(l=>lessonBalance(l).confirmed>=lessonBalance(l).total-0.005);
 const unreceived=done.reduce((sum,l)=>sum+lessonBalance(l).total-lessonBalance(l).confirmed,0);
 const received=done.reduce((sum,l)=>sum+lessonBalance(l).confirmed,0);
 const metrics=teacher?[
 ["本月已完成","◷",String(done.length),"<small>堂課</small>","繼續累積每一份努力"],
 ["本月上課時數","☷",hourTotal(ls).toFixed(1),"<small>小時</small>","依已完成課程計算"],
 ["尚待收款","◈",money(unreceived),"","未完成收款的課程"]]:[
 ["本月已完成","◷",String(done.length),"<small>堂課</small>","查看孩子的學習足跡"],
 ["本月上課時數","☷",hourTotal(ls).toFixed(1),"<small>小時</small>","依已完成課程計算"],
 ["待確認費用","◈",money(lessonSum(pending)),"","依課程付款狀態計算"]];
 $("#metrics").innerHTML=metrics.map(([label,icon,value,unit,foot])=>'<article class="metric-card"><div class="metric-label">'+label+'</div><div class="metric-icon">'+icon+'</div><div class="metric-value">'+esc(value)+(unit||"")+'</div><div class="metric-footer">'+foot+'</div></article>').join("");
 $("#money-reminder").textContent=teacher?"本月已確認收到 "+money(received)+"。":"目前有 "+pending.length+" 筆課程等待付款或收款確認。";
 renderNext();renderRecent();renderMiniCalendar();renderFullCalendar();renderBilling();renderStudents();refreshDaySheet();
}
function rowHTML(l,full=false){
 const s=studentFor(l),name=s?.name||l.student||"學生",p=pillClass(l);
 const actions=state.role==="teacher"?(
  (l.type==="planned"?'<button class="mini-action" data-action="complete" data-id="'+esc(l.id)+'">完成上課</button>':"")+
  (l.type==="lesson"&&l.status==="家長已付款"&&!state.paymentBatchItems.some(i=>i.lesson_id===l.id)?'<button class="mini-action" data-action="received" data-id="'+esc(l.id)+'">確認單堂收款</button>':"")+
  (full && l.type!=="moved"?'<button class="mini-action" data-action="edit" data-id="'+esc(l.id)+'">編輯</button><button class="mini-action" data-action="change-lesson" data-id="'+esc(l.id)+'">改期／請假</button>'+((l.type==="leave"||l.moved_from||(l.schedule_id&&l.scheduled_date&&l.lesson_date!==l.scheduled_date))?'<button class="mini-action" data-action="restore-lesson" data-id="'+esc(l.id)+'">恢復原安排</button>':""):(full&&l.type==="moved"?'<button class="mini-action" data-action="restore-lesson" data-id="'+esc(l.id)+'">還原原日期</button>':""))
 ):(l.type==="planned"||l.type==="lesson"?'<button class="mini-action" data-action="leave-request" data-id="'+esc(l.id)+'">請假</button>':"");
 const pay=state.role==="parent" && l.type==="lesson"&&lessonBalance(l).available>0?'<button class="mini-action" data-action="payment-period-single" data-id="'+esc(l.id)+'">我已付款</button>':"";
 return '<div class="lesson-row"><span class="lesson-color '+(p==="paid"?"sage":"")+'"></span><div class="lesson-main"><button type="button" class="day-lesson-open" data-action="open-lesson" data-id="'+esc(l.id)+'">'+esc(name)+' · '+esc(l.subject||s?.subject||"課程")+'</button><small>'+prettyDate(l.lesson_date)+' · '+esc(timeLabel(l.start_time))+'–'+esc(timeLabel(l.end_time))+'</small></div><div class="row-actions"><span class="pill '+p+'">'+esc(statusLabel(l))+'</span>'+(full?'<span class="lesson-amount">'+money(l.type==="lesson"?l.total_amount:0)+'</span>':"")+(l.schedule_id?'<span class="repeat-marker" title="固定課表">↻</span>':"")+actions+pay+'</div></div>';
}
function renderNext(){
 const next=visibleLessons().filter(l=>l.type==="planned"&&l.lesson_date>=dateKey(tick())).sort((a,b)=>(a.lesson_date+" "+a.start_time).localeCompare(b.lesson_date+" "+b.start_time))[0];
 $("#next-lesson").innerHTML=next?'<h2 class="next-heading">'+esc((studentFor(next)?.name||next.student||"學生")+' · '+next.subject)+'</h2><div class="next-meta"><span class="date-tag">'+prettyDate(next.lesson_date)+'</span><span>'+esc(timeLabel(next.start_time))+' – '+esc(timeLabel(next.end_time))+'</span></div><div class="next-actions"><button class="button-outline" data-view="calendar" data-date="'+esc(next.lesson_date)+'">查看這一天 ↗</button>'+(state.role==="teacher"?'<button class="text-link" data-action="complete" data-id="'+esc(next.id)+'">完成上課</button>':'<button class="text-link" data-action="leave-request" data-id="'+esc(next.id)+'">我要請假</button>')+'</div>':'<div class="empty">目前沒有即將開始的課程。<br>慢慢來，也是一種很好的節奏。</div>';
}
function renderRecent(){
 const rows=visibleLessons().filter(l=>l.type!=="leave"&&l.type!=="moved").sort((a,b)=>(b.lesson_date+" "+b.start_time).localeCompare(a.lesson_date+" "+a.start_time)).slice(0,4);
 $("#recent-lessons").innerHTML=rows.length?rows.map(l=>rowHTML(l)).join(""):'<div class="empty">還沒有課程紀錄。新增第一堂課，開始累積吧。</div>';
}
function daysForMonth(month){
 const y=month.getFullYear(),m=month.getMonth(),start=new Date(y,m,1),offset=(start.getDay()+6)%7;return Array.from({length:42},(_,i)=>new Date(y,m,1+i-offset));
}
function renderMiniCalendar(){
 $("#mini-month").textContent=(state.month.getFullYear())+" 年 "+(state.month.getMonth()+1)+" 月";
 const all=new Set(visibleLessons().map(l=>l.lesson_date));
 $("#mini-calendar").innerHTML='<div class="mini-weekdays">'+["一","二","三","四","五","六","日"].map(w=>"<span>"+w+"</span>").join("")+'</div><div class="mini-days">'+daysForMonth(state.month).map(d=>{const key=dateKey(d);return '<span class="mini-day '+(d.getMonth()!==state.month.getMonth()?"outside ":"")+(key===dateKey(tick())?"today ":"")+(all.has(key)?"has-event ":"")+'">'+d.getDate()+'</span>'}).join("")+'</div>';
}
function renderFullCalendar(){
 $("#calendar-month").textContent=state.month.getFullYear()+"年 "+(state.month.getMonth()+1)+"月";
 const ls=visibleLessons();
 $("#calendar-grid").innerHTML=daysForMonth(state.month).map(d=>{
  const day=dateKey(d),items=ls.filter(l=>l.lesson_date===day).sort((a,b)=>asText(a.start_time).localeCompare(asText(b.start_time)));
  return '<div class="calendar-cell '+(d.getMonth()!==state.month.getMonth()?"outside ":"")+(state.selected===day?"selected ":"")+(items.length?"has-events":"")+'" data-day="'+day+'" role="button" tabindex="0" aria-label="'+prettyDate(day)+' '+items.length+'堂課"><div class="day-number '+(day===dateKey(tick())?"today":"")+'">'+d.getDate()+'</div>'+items.slice(0,2).map(l=>'<button type="button" class="calendar-event lesson-event-click '+(l.type==="leave"||l.type==="moved"?"leave":l.type==="lesson"?"done":"")+'" data-action="open-lesson" data-id="'+esc(l.id)+'">'+esc(l.type==="moved"?"改期":l.type==="leave"?"請假":(studentFor(l)?.name||l.student||"學生"))+' '+esc(timeLabel(l.start_time))+'</button>').join("")+(items.length>2?'<div class="more-count">＋'+(items.length-2)+' 堂</div>':"")+'</div>';
 }).join("");
 $("#selected-date-title").textContent=prettyDate(state.selected)+" 的課程";
 const rows=ls.filter(l=>l.lesson_date===state.selected).sort((a,b)=>asText(a.start_time).localeCompare(asText(b.start_time)));
 $("#agenda-list").innerHTML=rows.length?rows.map(l=>rowHTML(l,true)).join(""):'<div class="empty">這天目前還沒有課程，可以好好休息一下。</div>';
 $("#agenda-add").style.display=state.role==="teacher"?"":"none";
 $("#manage-schedules").style.display=state.role==="teacher"?"":"none";
 renderCalendarDisplay();
}
function renderCalendarDisplay(){
 const lessons=visibleLessons().filter(l=>sameMonth(l.lesson_date,state.month))
  .sort((a,b)=>(a.lesson_date+" "+asText(a.start_time)).localeCompare(b.lesson_date+" "+asText(b.start_time)));
 const helpers={studentName:l=>studentFor(l)?.name||l.student||"學生",prettyDate,timeLabel,statusLabel,esc};
 const listed=state.calendarMode==="list";
 $("#month-overview").textContent=monthSummary(lessons)+" · 點日期管理當日安排";
 $("#calendar-month-view").classList.toggle("hidden",listed);
 $("#calendar-month-preview").classList.toggle("hidden",listed);
 $("#calendar-list-view").classList.toggle("hidden",!listed);
 $$("[data-calendar-mode]").forEach(b=>{const active=b.dataset.calendarMode===state.calendarMode;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active))});
 if(listed)$("#month-lesson-list").innerHTML=monthAgendaMarkup(lessons,helpers);
 else{
  const upcoming=lessons.filter(l=>l.lesson_date>=dateKey(tick()));
  const preview=(upcoming.length?upcoming:lessons.slice(-5)).slice(0,5);
  $("#month-lesson-preview").innerHTML=monthAgendaMarkup(preview,helpers);
 }
 // Mobile month cells remain compact while still revealing lesson counts and full entries below.
 const counts=new Map();
 for(const l of visibleLessons()){if(l.type!=="moved")counts.set(l.lesson_date,(counts.get(l.lesson_date)||0)+1)}
 $$(".calendar-cell").forEach(cell=>{
  const n=counts.get(cell.dataset.day)||0;
  if(n){const mark=document.createElement("span");mark.className="mobile-lesson-count";mark.setAttribute("aria-hidden","true");mark.textContent=n+"堂";cell.appendChild(mark)}
 });
}
function changeCalendarMode(mode){
 if(mode!=="month"&&mode!=="list")return;
 state.calendarMode=mode;localStorage.setItem(CALENDAR_MODE_STORAGE,mode);renderFullCalendar();
}

function renderBilling(){
 const ls=monthLessons().filter(l=>l.type==="lesson").sort((a,b)=>a.lesson_date.localeCompare(b.lesson_date));
 const billed=ls.reduce((sum,l)=>sum+lessonBalance(l).total,0);
 const confirmed=ls.reduce((sum,l)=>sum+lessonBalance(l).confirmed,0);
 const pending=ls.reduce((sum,l)=>sum+lessonBalance(l).pending,0);
 $("#billing-title").textContent=state.role==="teacher"?"收付款整理":"付款與對帳";
 $("#billing-month").textContent=state.month.getFullYear()+"年 "+(state.month.getMonth()+1)+"月";
 $("#billing-summary").innerHTML=[
  ["本月課程費用","◈",money(billed)],
  ["老師已確認收款","✓",money(confirmed)],
  ["尚未確認收款","◷",money(Math.max(0,billed-confirmed))]
 ].map(([label,icon,value])=>'<div class="metric-card"><span class="metric-label">'+label+'</span><span class="metric-icon">'+icon+'</span><div class="metric-value">'+value+'</div></div>').join("");
 $("#batch-action").classList.remove("hidden");
 $("#batch-action").textContent=state.role==="teacher"?"查看指定期間收款":"選擇期間回報已付款";
 $("#billing-list").innerHTML=ls.length?ls.map(l=>rowHTML(l,true)).join(""):'<div class="empty">這個月還沒有已完成的課程。排定的未上課時段不會算入費用。</div>';
 renderPaymentHistory();
 const reqs=state.requests.filter(r=>state.role==="teacher"?(state.mode==="demo"||r.teacher_id===activeUser?.id):
 (state.mode==="demo"||r.parent_id===activeUser?.id&&(state.parentTeacherFilter==="all"||r.teacher_id===state.parentTeacherFilter)))
  .sort((a,b)=>(a.status==="pending"?0:1)-(b.status==="pending"?0:1)||(b.created_at||"").localeCompare(a.created_at||""));
 $("#requests-list").innerHTML=reqs.length?reqs.map(r=>{const student=state.students.find(s=>s.id===r.student_id),lesson=state.lessons.find(l=>l.id===r.lesson_id),tag=r.status==="pending"?"待確認":r.status==="approved"?"已同意":"未同意";
 return '<div class="request-row"><span class="lesson-color '+(r.status==="approved"?"sage":"")+'"></span><div class="lesson-main"><strong>'+esc(student?.name||"學生")+' · '+(r.kind==="leave"?"請假申請":r.kind==="time_correction"?"實際時間更正申請":"單堂付款回報")+'</strong><small>'+esc(lesson?.lesson_date||r.scheduled_date||"")+' '+(r.kind==="time_correction"?esc(r.requested_actual_start_time)+"–"+esc(r.requested_actual_end_time)+" · "+esc(r.requested_actual_hours)+" 小時 · ":"")+esc(r.note||"")+'</small></div><span class="pill '+(r.status==="approved"?"paid":r.status==="pending"?"pending":"")+'">'+tag+'</span>'+(state.role==="teacher"&&r.status==="pending"?'<button class="mini-action" data-action="approve-request" data-id="'+esc(r.id)+'">同意</button><button class="mini-action" data-action="decline-request" data-id="'+esc(r.id)+'">不接受</button>':"")+'</div>'}).join(""):'<div class="empty">目前沒有需要處理的單堂請假或付款申請。</div>';
}
function renderStudents(){
 const st=visibleStudents();
 $("#add-student").style.display=state.role==="teacher"?"":"none";
 $("#student-grid").innerHTML=st.length?st.map(s=>'<article class="student-card"><div class="student-icon">✿</div><h3>'+esc(s.name)+'</h3><p>'+esc(s.subject||"課程")+' · '+money(s.hourly_rate)+'／小時</p><div class="tag-line">已安排 '+visibleLessons().filter(l=>l.student_id===s.id).length+' 堂課</div></article>').join(""):'<div class="card empty">目前沒有學生資料。'+(state.role==="parent"?"請先接受老師的邀請。":"先新增一位學生吧。")+'</div>';
 const parent=state.role==="parent";$("#invite-title").textContent=parent?"家長邀請":"邀請家長加入";$("#invite-description").textContent=parent?"老師邀請你後，可以在這裡確認連結。":"輸入家長的 Google 帳號 Email，登入後即可取得孩子的課程檢視權限。";
 if(parent){
  const connected=new Set(state.guardians.map(g=>g.student_id));
  const invites=state.invites.filter(i=>state.mode==="demo"||i.email===activeUser?.email?.toLowerCase());
  $("#invite-content").innerHTML=invites.length?invites.map(i=>'<div class="request-row"><div class="lesson-main"><strong>'+esc(state.students.find(s=>s.id===i.student_id)?.name||"學生邀請")+'</strong><small>'+esc(workspaceTitle(i.teacher_id))+' · '+esc(i.email)+'</small></div>'+(connected.has(i.student_id)?'<span class="pill paid">已加入</span>':'<button class="secondary-button" data-action="accept-invite" data-id="'+esc(i.id)+'">接受邀請</button>')+'</div>').join(""):'<div class="empty">尚未收到邀請。請老師使用你 Google 帳號的 Email 發送邀請。</div>';
 }else{
  $("#invite-content").innerHTML=st.length?'<form class="invite-form" id="invite-form"><label>選擇學生<select id="invite-student">'+st.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select></label><label>家長的 Google Email<input id="invite-email" type="email" required placeholder="parent@gmail.com" autocomplete="email"></label><button type="submit" class="primary-button">建立邀請</button></form><div class="invite-list">'+state.invites.filter(i=>state.mode==="demo"||i.teacher_id===activeUser?.id).map(i=>'<div class="lesson-row"><div class="lesson-main"><strong>'+esc(i.email)+'</strong><small>'+esc(st.find(s=>s.id===i.student_id)?.name||"學生")+'</small></div><span class="pill">已建立邀請</span></div>').join("")+'</div>':'<div class="empty">新增學生後，就可以邀請家長共同查看課程。</div>';
 }
}
// V3: Only teacher-owned, non-sensitive form defaults are synchronized across devices.
function recentCourseForStudent(studentId){
 return state.lessons.filter(l=>l.student_id===studentId&&l.type!=="leave"&&l.type!=="moved"
   &&(state.mode==="demo"||l.owner_id===activeUser?.id))
  .sort((a,b)=>String(b.updated_at||b.created_at||b.lesson_date||"").localeCompare(String(a.updated_at||a.created_at||a.lesson_date||"")))[0]||null;
}
function teacherStudentDefaults(studentId){
 const student=visibleStudents().find(s=>s.id===studentId);
 const prev=teacherPreferences.byStudent?.[studentId]||{};
 const course=recentCourseForStudent(studentId);
 return {
  subject:prev.subject||course?.subject||student?.subject||teacherPreferences.lastSubject||"數學",
  rate:prev.rate??course?.hourly_rate??student?.hourly_rate??teacherPreferences.lastRate??500,
  start:prev.start||course?.start_time||teacherPreferences.lastStart||"19:00",
  end:prev.end||course?.end_time||teacherPreferences.lastEnd||"20:30"
 };
}
function optionValues(studentId){
 const student=visibleStudents().find(s=>s.id===studentId),prev=teacherPreferences.byStudent?.[studentId];
 const lessons=state.lessons.filter(l=>state.mode==="demo"||l.owner_id===activeUser?.id);
 const rates=[prev?.rate,student?.hourly_rate,teacherPreferences.lastRate,...(teacherPreferences.recentRates||[]),...lessons.map(l=>l.hourly_rate)]
  .map(Number).filter(n=>Number.isFinite(n)&&n>=0);
 const subjects=[prev?.subject,student?.subject,teacherPreferences.lastSubject,...(teacherPreferences.recentSubjects||[]),...lessons.map(l=>l.subject)]
  .filter(x=>typeof x==="string"&&x.trim());
 return {rates:[...new Set(rates)].slice(0,15),subjects:[...new Set(subjects)].slice(0,15)};
}
function setDatalist(id,values){
 const el=$("#"+id);if(el)el.innerHTML=values.map(v=>'<option value="'+esc(v)+'"></option>').join("");
}
function refreshFormOptions(studentId){
 const options=optionValues(studentId);
 ["record-rate-options","schedule-rate-options","student-rate-options"].forEach(id=>setDatalist(id,options.rates));
 ["record-subject-options","schedule-subject-options","student-subject-options"].forEach(id=>setDatalist(id,options.subjects));
}
function selectStudentDefaults(prefix,studentId){
 const d=teacherStudentDefaults(studentId);
 const fields=prefix==="record"?
  {subject:"record-subject",rate:"record-rate",start:"record-start",end:"record-end"}:
  {subject:"schedule-subject",rate:"schedule-rate",start:"schedule-time-start",end:"schedule-time-end"};
 $("#"+fields.subject).value=d.subject;$("#"+fields.rate).value=d.rate;
 $("#"+fields.start).value=timeLabel(d.start);$("#"+fields.end).value=timeLabel(d.end);
 refreshFormOptions(studentId);
}
async function loadTeacherPreferences(){
 teacherPreferences={};
 if(state.mode==="demo"){
  try{teacherPreferences=JSON.parse(localStorage.getItem("tutor_v3_demo_form_preferences")||"{}")||{}}catch{}
  return;
 }
 if(!client||!activeUser||!myWorkspace())return;
 const {data,error}=await client.from("teacher_preferences").select("settings").eq("owner_id",activeUser.id).maybeSingle();
 if(error)throw error;
 teacherPreferences=data?.settings&&typeof data.settings==="object"?data.settings:{};
}
async function rememberTeacherForm(values){
 if(state.role!=="teacher")return;
 const prefs={...teacherPreferences,byStudent:{...(teacherPreferences.byStudent||{})}};
 if(values.studentId){
  prefs.lastStudentId=values.studentId;
  const old=prefs.byStudent[values.studentId]||{};
  prefs.byStudent[values.studentId]={...old,
   ...(values.subject?{subject:values.subject}:{}),
   ...(values.rate!==undefined?{rate:values.rate}:{}),
   ...(values.start?{start:values.start}:{}),
   ...(values.end?{end:values.end}:{})
  };
  // Keep the preference payload bounded, never accumulate all student records.
  const ids=[values.studentId,...Object.keys(prefs.byStudent).filter(id=>id!==values.studentId)].slice(0,16);
  prefs.byStudent=Object.fromEntries(ids.map(id=>[id,prefs.byStudent[id]]));
 }
 if(values.subject){prefs.lastSubject=values.subject;prefs.recentSubjects=[...new Set([values.subject,...(prefs.recentSubjects||[])])].slice(0,10)}
 if(values.rate!==undefined&&Number.isFinite(Number(values.rate))){
  prefs.lastRate=Number(values.rate);
  prefs.recentRates=[...new Set([Number(values.rate),...(prefs.recentRates||[])])].slice(0,10);
 }
 if(values.start)prefs.lastStart=values.start;
 if(values.end)prefs.lastEnd=values.end;
 if(values.repeat)prefs.lastRepeat=values.repeat;
 if(values.weekdays?.length)prefs.lastWeekdays=values.weekdays;
 teacherPreferences=prefs;
 try{
  if(state.mode==="demo")localStorage.setItem("tutor_v3_demo_form_preferences",JSON.stringify(prefs));
  else if(client&&activeUser&&myWorkspace()){
   const {error}=await client.from("teacher_preferences").upsert({owner_id:activeUser.id,settings:prefs,updated_at:new Date().toISOString()},{onConflict:"owner_id"});
   if(error)throw error;
  }
 }catch(err){console.warn("已儲存課程，但常用選項未能同步",err);toast("課程已儲存；常用選項同步未完成")}
}
function updateRecordRepeatUI(){
 const repeat=$("#record-repeat").value,editing=Boolean(state.editing);
 $("#repeat-label").classList.toggle("hidden",editing);
 $("#record-weekdays-wrap").classList.toggle("hidden",editing||!["weekly","biweekly"].includes(repeat));
 $("#until-label").classList.toggle("hidden",editing||repeat==="none");
 $("#repeat-until-caption").textContent=repeat==="monthly"?"每月重複到（空白預設下個月，最多 52 堂）":"重複到日期（可留空，空白代表長期）";
}

function openRecord(lesson=null){
 if(state.role!=="teacher"){toast("只有老師能安排課程");return}
 if(!requireTeacherWorkspace())return;
 const st=visibleStudents();if(!st.length){toast("請先新增學生，再安排課程");showModal("student-modal");return}
 state.editing=lesson?.id||null;
 $("#record-modal-title").textContent=lesson?"編輯課程":"新增一堂課";
 $("#record-student").innerHTML=st.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");
 $("#record-student").value=lesson?.student_id||
  (st.some(s=>s.id===teacherPreferences.lastStudentId)?teacherPreferences.lastStudentId:st[0].id);
 const d=teacherStudentDefaults($("#record-student").value);
 $("#record-subject").value=lesson?.subject||d.subject;
 $("#record-rate").value=lesson?.hourly_rate??d.rate;
 refreshFormOptions($("#record-student").value);
 $("#record-date").value=lesson?.lesson_date||state.selected;
 $("#record-start").value=timeLabel(lesson?.start_time||d.start);
 $("#record-end").value=timeLabel(lesson?.end_time||d.end);
 $("#record-remarks").value=lesson?.remarks||"";
 $("#record-focus").value=lesson?.focus_rating??"";
 $("#record-attitude").value=lesson?.attitude_rating??"";
 $("#record-repeat").value="none"; // Explicit opt-in avoids accidental bulk scheduling.
 $("#record-until").value="";
 const weekday=((parseDate($("#record-date").value).getDay()+6)%7)+1;
 const saved=teacherPreferences.lastWeekdays||[weekday];
 $$("#record-weekdays input").forEach(el=>el.checked=saved.includes(Number(el.value)));
 updateRecordRepeatUI();
 showModal("record-modal");
}
function scheduleDates(day,repeat,until){
 const first=parseDate(day),out=[day],end=until||dateKey(new Date(first.getFullYear(),first.getMonth()+1,first.getDate()));
 for(let i=1;i<52&&repeat!=="none";i++){
  let d;
  if(repeat==="monthly"){const wanted=first.getDate(),last=new Date(first.getFullYear(),first.getMonth()+i+1,0).getDate();d=new Date(first.getFullYear(),first.getMonth()+i,Math.min(wanted,last))}
  else d=new Date(first.getFullYear(),first.getMonth(),first.getDate()+(repeat==="weekly"?7:14)*i);
  if(dateKey(d)>end)break;
  out.push(dateKey(d));
 }
 return out;
}
async function persist(op){
 if(loading)return false;
 setBusy(true);
 try{
  if(state.mode==="live"&&!activeUser)throw Error("請先登入再修改課程");
  await op();
  if(state.mode==="demo")saveDemo();
 }catch(err){
  console.error(err);
  toast("儲存未完成："+(err.message||"請稍後再試"));
  setBusy(false);
  return false;
 }
 // A successful mutation must not be reported as a failed write solely because rendering fails.
 try{
  if(state.mode==="live")await refreshLive();
  render();
 }catch(err){
  console.error("資料已儲存但同步／畫面更新失敗",err);
  toast("資料已儲存，但畫面更新失敗；請重新整理確認");
 }finally{setBusy(false)}
 return true;
}
function assertResult({error,data}){if(error)throw error;return data}
async function saveRecord(ev){
 ev.preventDefault();if(state.role!=="teacher")return;
 const s=visibleStudents().find(x=>x.id===$("#record-student").value);
 if(!s){toast("請選擇學生");return}
 const date=$("#record-date").value,start=$("#record-start").value,end=$("#record-end").value,rate=num($("#record-rate").value);
 const hours=(Number(end.slice(0,2))*60+Number(end.slice(3)) - Number(start.slice(0,2))*60-Number(start.slice(3)))/60;
 if(hours<=0||hours>16){toast("請確認上課結束時間晚於開始時間");return}
 const common={student_id:s.id,student:s.name,subject:$("#record-subject").value.trim(),start_time:start,end_time:end,hours:Math.round(hours*100)/100,hourly_rate:rate,total_amount:Math.round(hours*rate*100)/100,remarks:$("#record-remarks").value.trim(),focus_rating:$("#record-focus").value?num($("#record-focus").value):null,attitude_rating:$("#record-attitude").value?num($("#record-attitude").value):null};
 if(!common.subject){toast("請填寫科目");return}
 const edited=resolveLesson(state.editing);
 if(edited?.status==="老師已收到"){toast("這堂課已確認收款，請先處理帳務，避免影響歷史對帳");return}
 if(edited){
  const item={...common,lesson_date:date};
  const ok=await persist(async()=>{
   if(isVirtualOccurrence(edited)){
     const row={...item,owner_id:edited.owner_id,schedule_id:edited.schedule_id,scheduled_date:edited.scheduled_date,type:"planned",status:"未付款"};
     if(state.mode==="demo")state.lessons.push({id:uid(),...row});
     else assertResult(await client.from("lesson_records").insert(row));
   }else if(state.mode==="demo")Object.assign(edited,item);
   else assertResult(await client.from("lesson_records").update(item).eq("id",edited.id).select("id").single());
 });if(ok){await rememberTeacherForm({studentId:s.id,subject:common.subject,rate,start,end});closeModal("record-modal");closeModal("day-modal");toast("課程已更新")}return;
 }
 const repeat=$("#record-repeat").value;
 if(["weekly","biweekly"].includes(repeat)){
  const weekdays=$$("#record-weekdays input:checked").map(el=>Number(el.value)).sort((a,b)=>a-b);
  if(!weekdays.length){toast("請至少選擇一個固定上課星期");return}
  const rule={teacher_id:activeUser?.id||"demo-teacher",student_id:s.id,subject:common.subject,
   weekdays,every_weeks:repeat==="biweekly"?2:1,starts_on:date,
   ends_on:$("#record-until").value||null,start_time:start,end_time:end,hourly_rate:rate};
  if(rule.ends_on&&rule.ends_on<date){toast("結束日期不能早於開始日期");return}
  const conflict=scheduleConflicts(rule);
  if(conflict.length&&!confirm("有 "+conflict.length+" 個可能重疊的時段，仍要建立嗎？"))return;
  const ok=await persist(async()=>{
   if(state.mode==="demo")state.schedules.push({id:uid(),...rule});
   else assertResult(await client.from("recurring_schedules").insert(rule));
  });
  if(ok){await rememberTeacherForm({studentId:s.id,subject:common.subject,rate,start,end,repeat,weekdays});
   closeModal("record-modal");toast("已建立固定課表：每"+(rule.every_weeks===2?"兩週":"週")+" "+weekdays.map(n=>["","一","二","三","四","五","六","日"][n]).join("、"))}
  return;
 }
 const dates=scheduleDates(date,repeat,$("#record-until").value);
 const records=dates.map(day=>({...common,lesson_date:day,type:"planned",status:"未付款",owner_id:activeUser?.id||"demo-teacher"}));
 const ok=await persist(async()=>{if(state.mode==="demo"){state.lessons.push(...records.map(x=>({...x,id:uid()})))}else assertResult(await client.from("lesson_records").insert(records))});
 if(ok){await rememberTeacherForm({studentId:s.id,subject:common.subject,rate,start,end,repeat});closeModal("record-modal");toast("已新增 "+records.length+" 堂課")}
}
async function saveStudent(ev){
 ev.preventDefault();if(state.role!=="teacher"||!requireTeacherWorkspace())return;
 const form=new FormData(ev.target),name=asText(form.get("name")).trim(),subject=asText(form.get("subject")).trim(),rate=num(form.get("hourly_rate"));
 if(!name)return;const data={name,subject,hourly_rate:rate,teacher_id:activeUser?.id||"demo-teacher"};
 const ok=await persist(async()=>{if(state.mode==="demo")state.students.push({id:uid(),...data});else assertResult(await client.from("students").insert(data))});if(ok){await rememberTeacherForm({subject,rate});closeModal("student-modal");ev.target.reset();toast("已新增學生")}
}
async function saveInvite(ev){
 ev.preventDefault();if(state.role!=="teacher"||!requireTeacherWorkspace())return;
 const student_id=$("#invite-student").value,email=$("#invite-email").value.trim().toLowerCase(),data={student_id,email,teacher_id:activeUser?.id||"demo-teacher"};
 const ok=await persist(async()=>{if(state.mode==="demo"){if(state.invites.some(i=>i.student_id===student_id&&i.email===email))throw Error("這位家長已在邀請清單中");state.invites.push({id:uid(),...data})}else assertResult(await client.from("guardian_invites").insert(data))});
 if(ok){$("#invite-email").value="";toast("已建立邀請，請家長登入後接受")}
}
async function updateLesson(id,patch,msg){
 const item=resolveLesson(id);
 if(!item||state.role!=="teacher"||item.type==="moved")return;
 if(item.status==="老師已收到"&&(patch.type==="leave"||patch.lesson_date||patch.hourly_rate!==undefined)){toast("已結清課程不能直接取消或改期，請先處理帳務");return}
 const ok=await persist(async()=>{
  if(isVirtualOccurrence(item)){
   // An occurrence becomes an explicit lesson only when someone edits or completes it.
   const payload={
    owner_id:item.owner_id,student_id:item.student_id,student:studentFor(item)?.name||"",
    subject:item.subject,lesson_date:item.lesson_date,schedule_id:item.schedule_id,
    scheduled_date:item.scheduled_date,start_time:item.start_time,end_time:item.end_time,
    hours:item.hours,hourly_rate:item.hourly_rate,total_amount:item.total_amount,
    type:item.type==="leave"?"planned":item.type,status:"未付款",...patch
   };
   if(state.mode==="demo")state.lessons.push({id:uid(),...payload});
   else assertResult(await client.from("lesson_records").insert(payload));
  }else if(state.mode==="demo")Object.assign(item,patch);
  else assertResult(await client.from("lesson_records").update(patch).eq("id",id).select("id").single());
 });
 if(ok){toast(msg);refreshDaySheet()}
 return ok;
}
function openRequest(id,kind){
 const l=resolveLesson(id);if(!l||l.type==="moved")return;
 if(isVirtualOccurrence(l)&&kind!=="leave"){toast("預排課程尚未上課，不能回報付款");return}
 $("#request-lesson-id").value=l.id;$("#request-kind").value=kind;$("#request-note").value="";
 $("#request-heading").textContent=kind==="leave"?"提出請假":"回報已付款";
 $("#request-description").textContent=(studentFor(l)?.name||"學生")+" · "+prettyDate(l.lesson_date)+"｜"+(kind==="leave"?"請假需要老師確認，不會立即取消課程。":"確認付款後，還需要老師核對收款。");
 showModal("request-modal");
}
async function submitRequest(ev){
 ev.preventDefault();const id=$("#request-lesson-id").value,l=resolveLesson(id);if(!l)return;
 if(state.role!=="parent"){toast("切換家長模式後才能申請");return}
 const kind=$("#request-kind").value;
 if(state.requests.some(r=>r.kind===kind&&r.status==="pending"&&(r.lesson_id===id||(isVirtualOccurrence(l)&&r.schedule_id===l.schedule_id&&r.scheduled_date===l.scheduled_date)))){toast("這堂課已經有待確認的申請");return}
 const data={lesson_id:isVirtualOccurrence(l)?null:l.id,schedule_id:isVirtualOccurrence(l)?l.schedule_id:null,scheduled_date:isVirtualOccurrence(l)?l.scheduled_date:null,student_id:l.student_id,teacher_id:l.owner_id,parent_id:activeUser?.id||"demo-parent",kind,note:$("#request-note").value.trim(),status:"pending"};
 const ok=await persist(async()=>{if(state.mode==="demo")state.requests.push({id:uid(),...data,created_at:new Date().toISOString()});else assertResult(await client.from("family_requests").insert(data))});
 if(ok){closeModal("request-modal");toast("已送出，等待老師確認")}
}
async function acceptInvite(id){
 const i=state.invites.find(x=>x.id===id);if(!i)return;
 const row={invite_id:i.id,teacher_id:i.teacher_id,student_id:i.student_id,guardian_id:activeUser?.id||"demo-parent"};
 const ok=await persist(async()=>{if(state.mode==="demo"){state.guardians.push({id:uid(),...row})}else assertResult(await client.from("student_guardians").insert(row))});if(ok)toast("已連結學生課程");
}
async function reviewRequest(id,approve){
 const r=state.requests.find(x=>x.id===id);if(!r||state.role!=="teacher")return;
 const newStatus=approve?"approved":"declined";
 const ok=await persist(async()=>{
  if(state.mode==="demo"){
   if(approve&&r.lesson_id){
    const l=state.lessons.find(l=>l.id===r.lesson_id);
    if(!l)throw Error("找不到對應課程");
    if((r.kind==="leave"||r.kind==="time_correction")&&lessonLocked(l))throw Error("課程已進入付款程序，請先處理帳務");
    if(r.kind==="leave")Object.assign(l,{type:"leave",leave_source:"student",actual_hours:null,actual_start_time:null,actual_end_time:null,hours:0,total_amount:0});
    else if(r.kind==="time_correction")Object.assign(l,{actual_start_time:r.requested_actual_start_time,actual_end_time:r.requested_actual_end_time,actual_hours:r.requested_actual_hours,hours:r.requested_actual_hours,total_amount:Math.round(Number(r.requested_actual_hours)*Number(l.hourly_rate)*100)/100});
    else Object.assign(l,{status:"家長已付款",payment_date:dateKey(tick())});
   }else if(approve&&r.schedule_id&&r.scheduled_date&&r.kind==="leave"){
    const record={schedule_id:r.schedule_id,original_date:r.scheduled_date,teacher_id:r.teacher_id,action:"student_leave",moved_to:null,remarks:r.note};
    const prev=state.exceptions.find(e=>e.schedule_id===r.schedule_id&&e.original_date===r.scheduled_date);
    if(prev)Object.assign(prev,record);else state.exceptions.push({id:uid(),...record});
   }
   r.status=newStatus;r.reviewed_at=new Date().toISOString();
  }else{
   assertResult(await client.rpc("review_family_request",{p_request_id:id,p_approve:approve}));
  }
 });
 if(ok)toast(approve?"已同意申請":"已婉拒申請");
}
function paymentBatchStatus(batch){return batch.status==="confirmed"?"老師已確認收款":batch.status==="declined"?"已退回":"等待老師確認"}
function batchLessons(batch){
 return state.paymentBatchItems.filter(i=>i.batch_id===batch.id).map(i=>({item:i,lesson:state.lessons.find(l=>l.id===i.lesson_id)}));
}
function paymentHistoryHTML(batches){
 if(!batches.length)return '<div class="empty">還沒有期間付款紀錄。家長可指定課程日期，回報整筆或部分款項。</div>';
 return batches.map(batch=>{
  const student=state.students.find(s=>s.id===batch.student_id),parts=batchLessons(batch),p=paymentBatchStatus(batch);
  return '<section class="period-batch"><div class="period-batch-head"><div><strong>'+esc(student?.name||"學生")+' · '+esc(batch.period_start)+' ～ '+esc(batch.period_end)+'</strong>'+
  '<small>家長實際付款：'+esc(batch.paid_on)+' · '+parts.length+' 堂課'+(batch.received_on?' · 老師實際收款：'+esc(batch.received_on):'')+'</small></div><div class="period-batch-amount">'+money(batch.paid_amount)+'</div></div>'+
  '<div class="period-batch-rows"><span class="pill '+(batch.status==="confirmed"?"paid":batch.status==="pending"?"pending":"")+'">'+p+'</span>'+
  (batch.note?'<span class="muted-small">'+esc(batch.note)+'</span>':"")+'</div>'+
  '<details><summary class="text-link">查看各堂金額分配</summary>'+
  parts.map(({item,lesson})=>'<div class="period-line"><div><strong>'+esc(lesson?.lesson_date||"")+' · '+esc(lesson?.subject||"課程")+'</strong><small>'+esc(timeLabel(lesson?.start_time||""))+'–'+esc(timeLabel(lesson?.end_time||""))+'</small></div><span>'+money(item.allocated_amount)+'</span></div>').join("")+'</details>'+
  (state.role==="teacher"&&batch.status==="pending"?
    '<div class="period-batch-actions"><button type="button" class="primary-button" data-action="confirm-batch" data-id="'+esc(batch.id)+'">確認這段期間已收款</button>'+
    '<button type="button" class="secondary-button" data-action="decline-batch" data-id="'+esc(batch.id)+'">退回付款回報</button></div>':"")+'</section>';
 }).join("");
}
function visiblePaymentBatches(){
 return state.paymentBatches.filter(b=>state.mode==="demo"||(state.role==="teacher"?b.teacher_id===activeUser?.id:
  b.parent_id===activeUser?.id&&(state.parentTeacherFilter==="all"||b.teacher_id===state.parentTeacherFilter)))
  .sort((a,b)=>asText(b.created_at).localeCompare(asText(a.created_at)));
}
function renderPaymentHistory(){
 $("#payment-batch-history").innerHTML=paymentHistoryHTML(visiblePaymentBatches());
}
function periodPreferenceKey(){
 return "tutor_v3_period_"+(state.mode==="live"?activeUser?.id||"guest":"demo")+"_"+state.role;
}
function getPeriodPreference(){
 try{const p=JSON.parse(localStorage.getItem(periodPreferenceKey())||"{}");
  return p&&typeof p==="object"?p:{};}catch{return {}}
}
function rememberPeriodPreference(){
 const p={studentId:$("#period-student").value,start:$("#period-start").value,end:$("#period-end").value};
 if(!visibleStudents().some(x=>x.id===p.studentId)||!p.start||!p.end||p.start>p.end)return;
 try{localStorage.setItem(periodPreferenceKey(),JSON.stringify(p))}catch{}
}
function openPeriodModal(studentId=null,start=null,end=null){
 const st=visibleStudents();if(!st.length){toast("目前沒有可結算的學生，請先完成學生與家長授權");return}
 $("#period-heading").textContent=state.role==="parent"?"回報指定期間已付款":"查詢指定期間收款";
 $("#period-help").textContent=state.role==="parent"?"選好學生與上課日期後，系統自動計算已完成且尚未結清的課程。":"選擇學生與日期，查看期間內的家長付款回報及收款狀態。";
 const last=getPeriodPreference();
 $("#period-student").innerHTML=st.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("");
 $("#period-student").value=(studentId&&st.some(x=>x.id===studentId)?studentId:
  (st.some(x=>x.id===last.studentId)?last.studentId:st[0].id));
 $("#period-start").value=start||last.start||dateKey(new Date(state.month.getFullYear(),state.month.getMonth(),1));
 $("#period-end").value=end||last.end||dateKey(new Date(state.month.getFullYear(),state.month.getMonth()+1,0));
 $("#period-paid-on").value=dateKey(tick());
 $("#period-paid-on").max=dateKey(tick());
 $("#period-note").value="";
 const parent=state.role==="parent";
 $("#parent-payment-fields").classList.toggle("hidden",!parent);
 $("#period-paid-on").required=parent;
 $("#period-paid-amount").required=parent;
 $("#period-submit").textContent=parent?"確認這段期間已付款":"關閉區間查詢";
 $("#period-start").max="9999-12-31";
 renderPeriodPreview(true);
 showModal("period-modal");
}
function filteredBatches(studentId,start,end){
 return visiblePaymentBatches().filter(b=>b.student_id===studentId&&b.period_start<=end&&b.period_end>=start);
}
function periodFormRows(){
 const studentId=$("#period-student").value,start=$("#period-start").value,end=$("#period-end").value;
 if(!start||!end||start>end)return {valid:false,message:"請選擇正確的課程起訖日期。",rows:[],total:0};
 if((parseDate(end)-parseDate(start))/86400000>730)return {valid:false,message:"每次最多結算約兩年的課程，請縮小日期區間。",rows:[],total:0};
 const rows=eligiblePeriodLessons({lessons:state.lessons,batches:state.paymentBatches,items:state.paymentBatchItems,requests:state.requests,studentId,start,end});
 return {valid:true,studentId,start,end,rows,total:rows.reduce((sum,r)=>sum+r.allocation.available,0)};
}
function renderPeriodPreview(resetAmount=false){
 const r=periodFormRows(),parent=state.role==="parent";
 if(!r.valid){
  $("#period-overview").textContent=r.message;$("#period-lesson-list").innerHTML="";
  $("#period-submit").disabled=parent;return;
 }
 rememberPeriodPreference();
 if(parent){
  const hours=r.rows.reduce((n,x)=>n+num(x.lesson.hours),0);
  $("#period-overview").innerHTML='<strong>'+money(r.total)+'</strong><div class="period-summary-metrics"><span>'+r.rows.length+' 堂可結算</span><span>'+hours.toFixed(1)+' 小時</span><span>'+esc(r.start)+' ～ '+esc(r.end)+'</span></div>';
  $("#period-lesson-list").innerHTML=r.rows.length?r.rows.map(({lesson,allocation})=>
    '<div class="period-line"><div><strong>'+esc(lesson.lesson_date)+' · '+esc(lesson.subject||"課程")+'</strong><small>'+esc(timeLabel(lesson.start_time))+'–'+esc(timeLabel(lesson.end_time))+' · 可付款餘額</small></div><span>'+money(allocation.available)+'</span></div>').join(""):'<div class="empty">這段期間沒有可付款的課程；已收款或待老師確認的款項不會重複列入。</div>';
  if(resetAmount||!$("#period-paid-amount").value)$("#period-paid-amount").value=r.total>0?r.total.toFixed(2):"";
  $("#period-submit").disabled=r.total<=0;
 }else{
  const batches=filteredBatches(r.studentId,r.start,r.end);
  $("#period-overview").innerHTML='<strong>'+batches.length+' 筆付款紀錄</strong><div class="period-summary-metrics"><span>'+esc(r.start)+' ～ '+esc(r.end)+'</span><span>待確認 '+batches.filter(b=>b.status==="pending").length+' 筆</span></div>';
  $("#period-lesson-list").innerHTML=paymentHistoryHTML(batches);
  $("#period-submit").disabled=false;
 }
}
async function submitPeriod(ev){
 ev.preventDefault();
 if(state.role==="teacher"){closeModal("period-modal");return}
 const r=periodFormRows();if(!r.valid||r.total<=0){toast(r.message||"沒有可付款的課程");return}
 const paid=amount($("#period-paid-amount").value),paidOn=$("#period-paid-on").value,note=$("#period-note").value.trim();
 if(!Number.isFinite(paid)||paid<=0||paid>r.total+0.005){toast("請填寫大於零且不超過未付款餘額的金額");return}
 if(!paidOn||paidOn>dateKey(tick())){toast("實際付款日期不能是未來日期");return}
 if(!confirm("確認回報 "+r.start+" 至 "+r.end+" 的課程，實際在 "+paidOn+" 支付 "+money(paid)+"？老師仍需核對入帳。"))return;
 const student=state.students.find(x=>x.id===r.studentId);if(!student){toast("找不到學生");return}
 const assignments=allocateOldestFirst(r.rows,paid);
 const ok=await persist(async()=>{
  if(state.mode==="demo"){
   const batchId=uid();state.paymentBatches.push({id:batchId,parent_id:"demo-parent",teacher_id:student.teacher_id,student_id:student.id,
    period_start:r.start,period_end:r.end,paid_on:paidOn,paid_amount:paid,note,status:"pending",received_on:null,created_at:new Date().toISOString()});
   state.paymentBatchItems.push(...assignments.map(i=>({batch_id:batchId,lesson_id:i.lesson_id,allocated_amount:i.allocated_amount})));
  }else{
   assertResult(await client.rpc("submit_range_payment",{
    p_teacher_id:student.teacher_id,p_student_id:student.id,p_period_start:r.start,p_period_end:r.end,
    p_paid_on:paidOn,p_paid_amount:paid,p_note:note
   }));
  }
 });
 if(ok){closeModal("period-modal");toast("已回報期間付款，等待老師核對收款")}
}
function openReceiptModal(id){
 if(state.role!=="teacher")return;
 const batch=visiblePaymentBatches().find(b=>b.id===id&&b.status==="pending");if(!batch){toast("找不到待核對的付款批次");return}
 state.receiptBatch=id;
 const student=state.students.find(s=>s.id===batch.student_id);
 $("#receipt-details").innerHTML='<strong>'+money(batch.paid_amount)+'</strong><p>學生：'+esc(student?.name||"學生")+'</p>'+
  '<p>課程期間：'+esc(batch.period_start)+' ～ '+esc(batch.period_end)+'</p>'+
  '<p>家長實際付款日期：'+esc(batch.paid_on)+'</p>'+
  '<p>核對課程：'+batchLessons(batch).length+' 堂</p>';
 $("#receipt-date").value=dateKey(tick());$("#receipt-date").max=dateKey(tick());
 closeModal("period-modal");showModal("receipt-modal");
}
async function reviewPeriodBatch(id,confirmPayment,receivedOn=null){
 const batch=visiblePaymentBatches().find(b=>b.id===id&&b.status==="pending");
 if(!batch||state.role!=="teacher"){toast("無法處理這筆付款");return}
 const ok=await persist(async()=>{
  if(state.mode==="demo"){
   batch.status=confirmPayment?"confirmed":"declined";batch.received_on=confirmPayment?receivedOn:null;batch.confirmed_at=confirmPayment?new Date().toISOString():null;
   for(const {lesson} of batchLessons(batch)){
    if(!confirmPayment||!lesson)continue;
    const l=lessonBalance(lesson);
    if(l.confirmed>=l.total-0.005){lesson.status="老師已收到";lesson.received_date=receivedOn}
   }
  }else assertResult(await client.rpc("review_range_payment",{p_batch_id:id,p_confirm:confirmPayment,p_received_on:receivedOn}));
 });
 if(ok){closeModal("receipt-modal");toast(confirmPayment?"已確認這段期間收款":"已退回付款回報，課程餘額已恢復")}
}
async function submitReceipt(ev){
 ev.preventDefault();const date=$("#receipt-date").value;
 if(!date||date>dateKey(tick())){toast("請輸入真實收到款項的日期");return}
 await reviewPeriodBatch(state.receiptBatch,true,date);
}


function lessonLocked(lesson){
 return !isVirtualOccurrence(lesson)&&isPaymentLocked(lesson,state.paymentBatches,state.paymentBatchItems,state.requests);
}
function openLessonPopup(id){
 const lesson=resolveLesson(id);
 if(!lesson){toast("找不到這堂課，請重新整理月曆");return}
 closeModal("day-modal");
 state.activeLesson=id;
 const d=actualDefaults(lesson);
 const teacher=state.role==="teacher",locked=lessonLocked(lesson),inactive=lesson.type==="leave"||lesson.type==="moved";
 $("#lesson-modal-heading").textContent=(studentFor(lesson)?.name||lesson.student||"學生")+" · "+(lesson.subject||"課程");
 $("#lesson-modal-date").textContent=prettyDate(lesson.lesson_date)+" · "+statusLabel(lesson);
 $("#lesson-planned-time").textContent=d.scheduledStart+" – "+d.scheduledEnd+"（"+(durationHours(d.scheduledStart,d.scheduledEnd)||0)+" 小時）";
 $("#lesson-status-hint").textContent=lesson.type==="lesson"?"已完成上課，可查看實際紀錄":lesson.type==="leave"?"本堂已請假／停課":lesson.type==="moved"?"本堂已改期":"原本預定的課程";
 $("#lesson-actual-start").value=d.actualStart;
 $("#lesson-actual-end").value=d.actualEnd;
 $("#lesson-actual-hours").value=String(d.actualHours);
 state.actualHoursManual=false;
 $("#lesson-lock-hint").classList.toggle("hidden",!locked);
 $("#lesson-teacher-actions").classList.toggle("hidden",!teacher);
 $("#lesson-parent-actions").classList.toggle("hidden",teacher);
 $("#lesson-parent-note-wrap").classList.toggle("hidden",teacher||inactive);
 $("#lesson-parent-note").value="";
 $("#lesson-time-editor").classList.toggle("hidden",inactive||(state.role==="parent"&&lesson.type!=="lesson"));
 $("#lesson-actual-heading").textContent=teacher?"實際上課時間":"實際時間更正建議";
 $("#lesson-save").textContent=lesson.type==="leave"?"恢復原安排":lesson.type==="lesson"?"儲存實際上課紀錄":lesson.type==="moved"?"查看改期安排":"確認完成上課";
 $("#lesson-save").disabled=locked||lesson.type==="moved";
 $("#lesson-student-leave").classList.toggle("hidden",inactive||locked);
 $("#lesson-teacher-leave").classList.toggle("hidden",inactive||locked);
 $("#lesson-move").classList.toggle("hidden",inactive||locked||lesson.type==="lesson");
 $("#lesson-parent-correct").classList.toggle("hidden",inactive||locked||lesson.type!=="lesson"||isVirtualOccurrence(lesson));
 $("#lesson-parent-leave").classList.toggle("hidden",inactive||locked);
 ["lesson-actual-start","lesson-actual-end","lesson-actual-hours"].forEach(id=>$("#"+id).disabled=inactive||locked);
 showModal("lesson-modal");
}
function lessonFormValues(){
 const start=$("#lesson-actual-start").value,end=$("#lesson-actual-end").value,hours=$("#lesson-actual-hours").value;
 return validateActual(start,end,hours);
}
function syncActualHoursFromTime(){
 if(state.actualHoursManual)return;
 const h=durationHours($("#lesson-actual-start").value,$("#lesson-actual-end").value);
 if(h!==null)$("#lesson-actual-hours").value=String(h);
}
async function saveLessonOutcome(ev){
 ev.preventDefault();
 const lesson=resolveLesson(state.activeLesson);
 if(!lesson||state.role!=="teacher")return;
 if(lesson.type==="leave"){closeModal("lesson-modal");await restoreLesson(lesson.id);return}
 if(lesson.type==="moved"||lessonLocked(lesson)){toast("請先處理已取消或已進入帳務流程的課程");return}
 let values;try{values=lessonFormValues()}catch(e){toast(e.message);return}
 const patch={type:"lesson",actual_start_time:values.actual_start_time,actual_end_time:values.actual_end_time,
  actual_hours:values.actual_hours,hours:values.hours,total_amount:Math.round(values.hours*Number(lesson.hourly_rate)*100)/100};
 const ok=await updateLesson(lesson.id,patch,lesson.type==="lesson"?"實際時數已更新":"已完成上課，費用會依實際計費時數計算");
 if(ok)closeModal("lesson-modal");
}
async function markLessonLeave(source){
 const lesson=resolveLesson(state.activeLesson);
 if(!lesson||state.role!=="teacher"||lesson.type==="moved"||lessonLocked(lesson))return;
 const label=source==="teacher"?"老師停課":"學生請假";
 if(!confirm("確認將 "+prettyDate(lesson.lesson_date)+" 的課程標記為「"+label+"」？本堂不再計入實際上課時數與應收費用，固定課表不受影響。"))return;
 let ok=false;
 if(isVirtualOccurrence(lesson)){
  ok=await persist(async()=>{await upsertException(lesson,source==="teacher"?"teacher_leave":"student_leave",null,"課後補登 "+label)});
 }else{
  ok=await updateLesson(lesson.id,{type:"leave",leave_source:source,actual_start_time:null,actual_end_time:null,actual_hours:null,hours:0,total_amount:0},"已記錄"+label);
 }
 if(ok!==false)closeModal("lesson-modal");
}
async function submitParentLessonRequest(kind){
 const lesson=resolveLesson(state.activeLesson);
 if(!lesson||state.role!=="parent"||lessonLocked(lesson))return;
 if(kind==="time_correction"&&(isVirtualOccurrence(lesson)||lesson.type!=="lesson")){toast("此課程尚未有實際上課紀錄");return}
 let fields={};
 if(kind==="time_correction"){
  try{
   const v=lessonFormValues();
   fields={requested_actual_start_time:v.actual_start_time,requested_actual_end_time:v.actual_end_time,requested_actual_hours:v.actual_hours};
  }catch(e){toast(e.message);return}
 }
 if(state.requests.some(r=>r.status==="pending"&&r.kind===kind
   &&(r.lesson_id===lesson.id||(isVirtualOccurrence(lesson)&&r.schedule_id===lesson.schedule_id&&r.scheduled_date===lesson.scheduled_date)))){
  toast("這堂課已有待老師確認的相同申請");return;
 }
 const data={kind,status:"pending",note:$("#lesson-parent-note").value.trim(),lesson_id:isVirtualOccurrence(lesson)?null:lesson.id,
  schedule_id:isVirtualOccurrence(lesson)?lesson.schedule_id:null,scheduled_date:isVirtualOccurrence(lesson)?lesson.scheduled_date:null,
  parent_id:activeUser?.id||"demo-parent",teacher_id:lesson.owner_id,student_id:lesson.student_id,...fields};
 const ok=await persist(async()=>{
  if(state.mode==="demo")state.requests.push({id:uid(),created_at:new Date().toISOString(),...data});
  else assertResult(await client.from("family_requests").insert(data));
 });
 if(ok){closeModal("lesson-modal");toast("已提交"+(kind==="leave"?"請假":"時間更正")+"申請，等待老師確認")}
}

function refreshDaySheet(){
 if(!$("#day-modal").open)return;
 const date=state.selected,items=visibleLessons().filter(l=>l.lesson_date===date).sort((a,b)=>asText(a.start_time).localeCompare(asText(b.start_time)));
 $("#day-modal-title").textContent=prettyDate(date);
 $("#day-modal-subtitle").textContent=items.length?"這一天有 "+items.filter(l=>l.type!=="moved").length+" 堂課，點選下方按鈕直接管理。":"目前沒有排課，可以新增單次課程或設定固定時段。";
 $("#day-modal-lessons").innerHTML=items.length?items.map(l=>rowHTML(l,true)).join(""):'<div class="empty">今天沒有安排課程，不需要額外標記不上課。</div>';
 $("#day-add-lesson").classList.toggle("hidden",state.role!=="teacher");
 $("#day-add-rule").classList.toggle("hidden",state.role!=="teacher");
}
function openDay(day){
 state.selected=day;state.month=new Date(parseDate(day).getFullYear(),parseDate(day).getMonth(),1);
 render();
 const options=visibleLessons().filter(l=>l.lesson_date===day&&l.type!=="moved");
 if(options.length===1){openLessonPopup(options[0].id);return}
 refreshDaySheet();showModal("day-modal");refreshDaySheet();
}
function scheduleRuleLabel(rule){
 const days=(rule.weekdays||[]).map(d=>"週"+["","一","二","三","四","五","六","日"][d]).join("、");
 const name=state.students.find(s=>s.id===rule.student_id)?.name||"學生";
 return name+" · "+rule.subject+"｜"+(rule.every_weeks===2?"雙週":"每週")+" "+days+" "+timeLabel(rule.start_time)+"–"+timeLabel(rule.end_time);
}
function renderScheduleRules(){
 const st=state.schedules.filter(r=>state.mode==="demo"||r.teacher_id===activeUser?.id);
 $("#schedule-rules-list").innerHTML=st.length?'<div class="schedule-rules-title">目前固定課表（'+st.length+' 組）</div>'+st.map(r=>
  '<div class="schedule-rule-row"><div><strong>'+esc(scheduleRuleLabel(r))+'</strong><small>'+esc(r.starts_on)+' 起'+(r.ends_on?' · 至 '+esc(r.ends_on):' · 長期')+'</small></div><button type="button" class="mini-action" data-action="edit-rule" data-id="'+esc(r.id)+'">編輯</button><button type="button" class="mini-action" data-action="stop-rule" data-id="'+esc(r.id)+'">停止</button></div>').join(""):'<div class="helper-note">目前沒有固定課表。選擇學生與日期，設定一次即可。</div>';
}
function openSchedule(rule=null){
 if(state.role!=="teacher"){toast("請先切換老師模式");return}
 const st=visibleStudents();if(!st.length){toast("請先建立學生資料");showModal("student-modal");return}
 closeModal("day-modal");
 state.editingSchedule=rule?.id||null;
 $("#schedule-form-title").textContent=rule?"調整固定課表":"新增固定課表";
 $("#schedule-rules-list").classList.toggle("hidden",!!rule);
 $("#schedule-scope").classList.toggle("hidden",!rule);
 $("#schedule-student").innerHTML=st.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.name)+'</option>').join("");
 $("#schedule-student").value=rule?.student_id||
  (st.some(x=>x.id===teacherPreferences.lastStudentId)?teacherPreferences.lastStudentId:st[0].id);
 const d=teacherStudentDefaults($("#schedule-student").value);
 $("#schedule-subject").value=rule?.subject||d.subject;
 refreshFormOptions($("#schedule-student").value);
 $("#schedule-frequency").value=String(rule?.every_weeks||Number(teacherPreferences.lastRepeat==="biweekly"?2:1));
 $("#schedule-start").value=rule? (rule.starts_on>dateKey(tick())?rule.starts_on:dateKey(tick())):state.selected;
 $("#schedule-time-start").value=timeLabel(rule?.start_time||d.start);
 $("#schedule-time-end").value=timeLabel(rule?.end_time||d.end);
 $("#schedule-rate").value=rule?.hourly_rate??d.rate;
 $("#schedule-end-date").value=rule?.ends_on||"";
 const initWeekday=rule?.weekdays?.map(Number)||
  (Array.isArray(teacherPreferences.lastWeekdays)&&teacherPreferences.lastWeekdays.length
   ?teacherPreferences.lastWeekdays:[((parseDate(state.selected).getDay()+6)%7)+1]);
 $$("#schedule-weekdays input").forEach(i=>i.checked=initWeekday.includes(Number(i.value)));
 $$('input[name="schedule-scope"]').forEach(r=>r.checked=r.value==="future");
 renderScheduleRules();showModal("schedule-modal");
}
function getScheduleForm(){
 const student_id=$("#schedule-student").value,subject=$("#schedule-subject").value.trim();
 const weekdays=$$("#schedule-weekdays input:checked").map(x=>Number(x.value)).sort((a,b)=>a-b);
 const every_weeks=Number($("#schedule-frequency").value),starts_on=$("#schedule-start").value;
 const ends_on=$("#schedule-end-date").value||null;
 const start_time=$("#schedule-time-start").value,end_time=$("#schedule-time-end").value;
 const hourly_rate=Number($("#schedule-rate").value);
 if(!student_id||!subject||!weekdays.length)throw Error("請選擇學生、科目及至少一個上課日");
 if(!starts_on||ends_on&&ends_on<starts_on)throw Error("請確認固定課表的開始與結束日期");
 if(!start_time||!end_time||start_time>=end_time)throw Error("結束時間必須晚於開始時間");
 if(!Number.isFinite(hourly_rate)||hourly_rate<0)throw Error("請輸入有效的鐘點費");
 if(![1,2].includes(every_weeks))throw Error("排課頻率不正確");
 return {student_id,subject,weekdays,every_weeks,starts_on,ends_on,start_time,end_time,hourly_rate};
}
function scheduleConflicts(candidate,editedRule=null){
 const preview=expandSchedules({schedules:[{...candidate,id:"preview-rule",teacher_id:activeUser?.id||"demo-teacher"}],lessons:[],exceptions:[],allowedStudents:[candidate.student_id],month:parseDate(candidate.starts_on),today:candidate.starts_on});
 return preview.filter(x=>x.type==="planned"&&x.lesson_date>=candidate.starts_on&&x.lesson_date<=dateKey(new Date(parseDate(candidate.starts_on).getFullYear(),parseDate(candidate.starts_on).getMonth()+2,parseDate(candidate.starts_on).getDate())))
  .flatMap(v=>findTimeConflicts(visibleLessons().filter(l=>l.schedule_id!==editedRule?.id),v).map(existing=>({day:v.lesson_date,lesson:existing}))).slice(0,6);
}
async function submitSchedule(event){
 event.preventDefault();if(state.role!=="teacher")return;
 let data;try{data=getScheduleForm()}catch(err){toast(err.message);return}
 const old=state.schedules.find(s=>s.id===state.editingSchedule);
 const choice=$('input[name="schedule-scope"]:checked')?.value||"future";
 const effective=data.starts_on;
 if(old&&choice==="all")data.starts_on=old.starts_on;
 if(old&&choice==="future"&&effective<dateKey(tick())&&effective!==old.starts_on){toast("從這堂以後修改只能選今天或未來的日期");return}
 if(data.ends_on&&data.ends_on<data.starts_on){toast("結束日期不可早於開始日期");return}
 const conflict=scheduleConflicts(data,old);
 if(conflict.length&&!confirm("這組固定課表有 "+conflict.length+" 個可能重疊的時段（例如 "+prettyDate(conflict[0].day)+"）。仍要建立嗎？"))return;
 if(old&&choice==="future"&&effective<old.starts_on){toast("生效日期不能早於原課表的開始日期");return}
 if(old&&choice==="future"&&old.ends_on&&effective>old.ends_on){toast("生效日期超過原課表的結束日期");return}
 const ok=await persist(async()=>{
  if(old){
   if(choice==="future"&&effective>old.starts_on){
    if(state.mode==="demo"){
      const until=new Date(parseDate(effective));until.setDate(until.getDate()-1);
      old.ends_on=dateKey(until);
      state.schedules.push({...data,id:uid(),teacher_id:old.teacher_id});
    }else assertResult(await client.rpc("split_recurring_schedule",{
      p_id:old.id,p_effective:effective,p_student_id:data.student_id,p_subject:data.subject,
      p_weekdays:data.weekdays,p_every_weeks:data.every_weeks,p_end_date:data.ends_on,
      p_start_time:data.start_time,p_end_time:data.end_time,p_hourly_rate:data.hourly_rate
    }));
   }else {
    // Editing the whole rule changes only projected dates. Stored lesson payments are not overwritten.
    if(state.mode==="demo")Object.assign(old,data);
    else assertResult(await client.from("recurring_schedules").update(data).eq("id",old.id).select("id").single());
   }
  }else{
   const row={...data,teacher_id:activeUser?.id||"demo-teacher"};
   if(state.mode==="demo")state.schedules.push({id:uid(),...row});
   else assertResult(await client.from("recurring_schedules").insert(row));
  }
 });
 if(ok){await rememberTeacherForm({studentId:data.student_id,subject:data.subject,rate:data.hourly_rate,
   start:data.start_time,end:data.end_time,repeat:data.every_weeks===2?"biweekly":"weekly",weekdays:data.weekdays});
  closeModal("schedule-modal");toast("固定課表已儲存；未來日期會自動顯示")}
}
async function stopSchedule(id){
 const rule=state.schedules.find(x=>x.id===id);if(!rule||state.role!=="teacher")return;
 if(!confirm("停止「"+scheduleRuleLabel(rule)+"」的未來排課？過去已上課與收款紀錄會保留。"))return;
 const today=dateKey(tick());
 if(rule.starts_on>=today){
  const hasRecords=state.lessons.some(l=>l.schedule_id===id);
  if(hasRecords){toast("此課表已有單堂紀錄，請使用編輯功能調整結束日期");return}
  const ok=await persist(async()=>{
    if(state.mode==="demo")state.schedules=state.schedules.filter(s=>s.id!==id);
    else assertResult(await client.from("recurring_schedules").delete().eq("id",id).select("id").single());
  });if(ok){renderScheduleRules();toast("已移除尚未開始的課表")}return;
 }
 const dayBefore=dateKey(new Date(parseDate(today).getFullYear(),parseDate(today).getMonth(),parseDate(today).getDate()-1));
 if(dayBefore<rule.starts_on){toast("課表今天才開始。請修改結束日期或取消單堂課");return}
 const ok=await persist(async()=>{if(state.mode==="demo")rule.ends_on=dayBefore;else assertResult(await client.from("recurring_schedules").update({ends_on:dayBefore}).eq("id",id).select("id").single())});
 if(ok){renderScheduleRules();toast("未來排課已停止，舊紀錄仍保留")}
}
function openChange(lesson){
 if(!lesson||lesson.type==="moved"||state.role!=="teacher")return;
 if(lessonLocked(lesson)){toast("已進入付款或收款程序，請先處理帳務");return}
 state.changingLesson=lesson.id;
 $("#change-title").textContent=(studentFor(lesson)?.name||"學生")+" · "+prettyDate(lesson.lesson_date);
 $("#change-description").textContent=lesson.schedule_id?"此操作只影響這一堂固定課，不會改掉其他週。":"這次調整只會影響選定的課程。";
 $("#change-action").value="reschedule";$("#change-new-date").value=lesson.lesson_date;
 $("#change-date-area").classList.remove("hidden");$("#change-note").value="";
 showModal("change-modal");
}
async function upsertException(lesson,action,moved_to,remarks){
 const row={teacher_id:lesson.owner_id,schedule_id:lesson.schedule_id,original_date:originalOccurrenceDate(lesson),action,moved_to,remarks};
 if(state.mode==="demo"){
  const existing=state.exceptions.find(e=>e.schedule_id===row.schedule_id&&e.original_date===row.original_date);
  if(existing)Object.assign(existing,row);else state.exceptions.push({id:uid(),...row});
 }else assertResult(await client.from("schedule_exceptions").upsert(row,{onConflict:"schedule_id,original_date"}));
}
async function submitChange(ev){
 ev.preventDefault();
 const lesson=resolveLesson(state.changingLesson);if(!lesson||state.role!=="teacher")return;
 const action=$("#change-action").value,day=$("#change-new-date").value,remarks=$("#change-note").value.trim();
 if(!isVirtualOccurrence(lesson)&&lesson.type==="lesson"){toast("已完成課程請使用「編輯」修正紀錄，不應直接標記停課");return}
 if(action==="reschedule"&&(!day||day===lesson.lesson_date)){toast("請選擇不同的補課日期");return}
 if(action==="reschedule"){
  const overlap=findTimeConflicts(visibleLessons(),{...lesson,lesson_date:day},lesson.id);
  if(overlap.length&&!confirm("新日期已有其他課程時間重疊，確定仍要改期嗎？"))return;
 }
 const ok=await persist(async()=>{
  if(isVirtualOccurrence(lesson)){
   await upsertException(lesson,action,action==="reschedule"?day:null,remarks);
  }else{
   const patch=action==="reschedule"?{lesson_date:day,remarks:remarks||lesson.remarks,type:"planned"}:
     {type:"leave",leave_source:action==="teacher_leave"?"teacher":"student",remarks:remarks||lesson.remarks,actual_hours:null,actual_start_time:null,actual_end_time:null,hours:0,total_amount:0};
   if(state.mode==="demo")Object.assign(lesson,patch);
   else assertResult(await client.from("lesson_records").update(patch).eq("id",lesson.id).select("id").single());
  }
 });
 if(ok){closeModal("change-modal");closeModal("day-modal");toast(action==="reschedule"?"已改期，其他固定課程不受影響":"已記錄請假／停課")}
}
async function restoreLesson(id){
 const lesson=resolveLesson(id);if(!lesson||state.role!=="teacher")return;
 if(lessonLocked(lesson)){toast("課程已進入收付款程序，請先處理帳務");return}
 const ok=await persist(async()=>{
  if(isVirtualOccurrence(lesson)&&lesson.schedule_id){
   if(state.mode==="demo")state.exceptions=state.exceptions.filter(e=>!(e.schedule_id===lesson.schedule_id&&e.original_date===lesson.scheduled_date));
   else assertResult(await client.from("schedule_exceptions").delete().eq("schedule_id",lesson.schedule_id).eq("original_date",lesson.scheduled_date).select("id").single());
  }else{
   const plannedHours=durationHours(timeLabel(lesson.start_time),timeLabel(lesson.end_time))||Number(lesson.hours)||1;
   const patch={type:"planned",leave_source:null,lesson_date:lesson.scheduled_date||lesson.lesson_date,
     actual_start_time:null,actual_end_time:null,actual_hours:null,hours:plannedHours,
     total_amount:Math.round(plannedHours*Number(lesson.hourly_rate)*100)/100};
   if(state.mode==="demo")Object.assign(lesson,patch);
   else assertResult(await client.from("lesson_records").update(patch).eq("id",lesson.id).select("id").single());
  }
 });
 if(ok){toast("已恢復原本的課程安排");refreshDaySheet()}
}

const LIVE_TABLES=["students","lesson_records","guardian_invites","student_guardians","family_requests","recurring_schedules","schedule_exceptions","payment_batches","payment_batch_items","profiles","workspaces","workspace_members"];
const LIVE_FIELDS=["students","lessons","invites","guardians","requests","schedules","exceptions","paymentBatches","paymentBatchItems","profiles","workspaces","workspaceMembers"];
const PAGE_SIZE=500;
async function fetchAllRows(table){
 const rows=[];
 const orderColumns=table==="payment_batch_items"?["batch_id","lesson_id"]:table==="workspace_members"?["workspace_id","user_id"]:table==="teacher_preferences"?["owner_id"]:["id"];
 for(let offset=0;offset<50000;offset+=PAGE_SIZE){
  let query=client.from(table).select("*");
  for(const column of orderColumns)query=query.order(column,{ascending:true});
  const {data,error}=await query.range(offset,offset+PAGE_SIZE-1);
  if(error)throw Error("資料同步失敗（"+table+"）："+error.message);
  const page=data||[];
  rows.push(...page);
  if(page.length<PAGE_SIZE)return rows;
 }
 throw Error(table+" 的資料超過單次安全載入上限，請改用日期範圍查詢");
}
async function refreshLive(){
 if(!client||!activeUser)return;
 const userId=activeUser.id;
 const results=await Promise.all(LIVE_TABLES.map(fetchAllRows));
 if(state.mode!=="live"||activeUser?.id!==userId)return;
 LIVE_FIELDS.forEach((key,i)=>{state[key]=results[i]});
}
async function ensureClient(){
 if(client)return client;
 const createClient=window.supabase?.createClient;
 if(!createClient)throw Error("登入元件載入失敗，請重新整理頁面後再試");
 client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 client.auth.onAuthStateChange((event,session)=>{activeUser=session?.user||null;if(event==="SIGNED_OUT"){activeUser=null;teacherPreferences={};state.parentTeacherFilter="all";for(const k of ["profiles","workspaces","workspaceMembers"])state[k]=[];state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();}});
 return client;
}
async function initializeLive(){
 try{
  await ensureClient();const {data,error}=await client.auth.getSession();if(error)throw error;
  activeUser=data.session?.user||null;
  if(activeUser){
   // Role is a display preference scoped to each account; authorization stays in RLS.
   await ensureMyProfile();
   await refreshLive();
   const priorRole=localStorage.getItem(ROLE_STORAGE+"_"+activeUser.id);
   const guardian=state.guardians.some(g=>g.guardian_id===activeUser.id);
   const invited=state.invites.some(i=>i.email===activeUser.email?.toLowerCase());
   state.role=priorRole==="parent"||priorRole==="teacher"?priorRole:
    (!myWorkspace()&&(guardian||invited)?"parent":"teacher");
   localStorage.setItem(ROLE_STORAGE+"_"+activeUser.id,state.role);
   await loadTeacherPreferences();
   toast("已登入並同步課程");
  }else{for(const k of LIVE_FIELDS)state[k]=[];teacherPreferences={};}
  render();
 }catch(err){console.error(err);toast("Supabase 連線失敗："+err.message);showModal("account-modal")}
}
async function googleLogin(){
 try{
  const db=await ensureClient();state.mode="live";localStorage.setItem(MODE_STORAGE,"live");
  const {error}=await db.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}});
  if(error)throw error;
 }catch(err){console.error(err);toast("Google 登入尚未完成："+err.message);showModal("account-modal")}
}
async function signOut(){
 if(client){const {error}=await client.auth.signOut();if(error){toast(error.message);return;}}
 activeUser=null;teacherPreferences={};state.parentTeacherFilter="all";for(const k of ["profiles","workspaces","workspaceMembers"])state[k]=[];state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();closeModal("account-modal");toast("已登出，目前使用預覽模式");
}
function toggleDemo(){
 teacherPreferences={};activeUser=null;state.parentTeacherFilter="all";for(const k of ["profiles","workspaces","workspaceMembers"])state[k]=[];state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();closeModal("account-modal");toast("現在可以自由試用，不影響正式資料");
}
function bindEvents(){
 document.addEventListener("click",async ev=>{
  const nav=ev.target.closest("[data-view]");if(nav){setView(nav.dataset.view);if(nav.dataset.date){state.selected=nav.dataset.date;state.month=parseDate(state.selected);render()}return}
  const close=ev.target.closest("[data-close]");if(close){closeModal(close.dataset.close);return}
  const switcher=ev.target.closest("[data-calendar-mode]");if(switcher){changeCalendarMode(switcher.dataset.calendarMode);return}
  const action=ev.target.closest("[data-action]");if(action){
   const id=action.dataset.id,kind=action.dataset.action;
   if(kind==="open-lesson"||kind==="complete"||kind==="edit"||kind==="leave-request"){openLessonPopup(id);return}
   if(kind==="received")await updateLesson(id,{status:"老師已收到",received_date:dateKey(tick())},"已確認收款");
   
   if(kind==="cancel-lesson")openChange(resolveLesson(id));
   if(kind==="change-lesson")openChange(resolveLesson(id));
   if(kind==="restore-lesson")await restoreLesson(id);
   if(kind==="edit-rule")openSchedule(state.schedules.find(r=>r.id===id));
   if(kind==="stop-rule")await stopSchedule(id);
   
   if(kind==="payment-period-single"){const l=resolveLesson(id);if(l)openPeriodModal(l.student_id,l.lesson_date,l.lesson_date)}
   if(kind==="accept-invite")await acceptInvite(id);
   if(kind==="approve-request")await reviewRequest(id,true);
   if(kind==="decline-request")await reviewRequest(id,false);
   if(kind==="confirm-batch")openReceiptModal(id);
   if(kind==="decline-batch")if(confirm("確定退回這筆期間付款？這不會刪除紀錄，但可付款餘額會重新開放。"))await reviewPeriodBatch(id,false,null);
  }
  const day=ev.target.closest("[data-day]");if(day){openDay(day.dataset.day);return}
 });
 document.addEventListener("keydown",ev=>{const el=ev.target.closest("[data-day]");if(el&&!ev.target.closest("[data-action]")&&(ev.key==="Enter"||ev.key===" ")){ev.preventDefault();openDay(el.dataset.day)}});
 $("#lesson-form").addEventListener("submit",saveLessonOutcome);
 ["lesson-actual-start","lesson-actual-end"].forEach(id=>$("#"+id).addEventListener("change",syncActualHoursFromTime));
 $("#lesson-actual-hours").addEventListener("input",()=>{state.actualHoursManual=true});
 $("#lesson-student-leave").onclick=()=>markLessonLeave("student");
 $("#lesson-teacher-leave").onclick=()=>markLessonLeave("teacher");
 $("#lesson-move").onclick=()=>{const lesson=resolveLesson(state.activeLesson);closeModal("lesson-modal");openChange(lesson)};
 $("#lesson-parent-correct").onclick=()=>submitParentLessonRequest("time_correction");
 $("#lesson-parent-leave").onclick=()=>submitParentLessonRequest("leave");
 $("#top-add").onclick=()=>openRecord();
 $("#agenda-add").onclick=()=>openRecord();
 $("#show-full-month").onclick=()=>changeCalendarMode("list");
 $("#manage-schedules").onclick=()=>openSchedule();
 $("#day-add-lesson").onclick=()=>{closeModal("day-modal");openRecord()};
 $("#day-add-rule").onclick=()=>openSchedule();
 $("#schedule-form").addEventListener("submit",submitSchedule);
 $("#change-form").addEventListener("submit",submitChange);
 $("#change-action").onchange=()=>$("#change-date-area").classList.toggle("hidden",$("#change-action").value!=="reschedule");
 $("#schedule-student").onchange=()=>{if(!state.editingSchedule)selectStudentDefaults("schedule",$("#schedule-student").value)};
 $("#add-student").onclick=()=>{
  if(!requireTeacherWorkspace())return;
  refreshFormOptions(teacherPreferences.lastStudentId||"");
  const form=$("#student-form");
  const subject=form.querySelector('[name="subject"]'),rate=form.querySelector('[name="hourly_rate"]');
  subject.value=teacherPreferences.lastSubject||"數學";
  rate.value=teacherPreferences.lastRate??500;
  showModal("student-modal");
 };
 $("#record-student").onchange=()=>{if(!state.editing)selectStudentDefaults("record",$("#record-student").value)};
 $("#prev-month").onclick=()=>moveMonth(-1);$("#next-month").onclick=()=>moveMonth(1);
 $("#billing-prev").onclick=()=>moveMonth(-1);$("#billing-next").onclick=()=>moveMonth(1);
 $("#batch-action").onclick=()=>openPeriodModal();
 $("#period-form").addEventListener("submit",submitPeriod);
 $("#receipt-form").addEventListener("submit",submitReceipt);
 for(const id of ["period-student","period-start","period-end"]){
  $("#"+id).addEventListener("change",()=>renderPeriodPreview(true));
 }
 $("#period-paid-amount").addEventListener("input",()=>{
  const r=periodFormRows(),value=amount($("#period-paid-amount").value);
  $("#period-submit").disabled=!r.valid||r.total<=0||!Number.isFinite(value)||value<=0||value>r.total+0.005;
 });
 $("#jump-today").onclick=()=>{state.month=new Date(tick().getFullYear(),tick().getMonth(),1);state.selected=dateKey(tick());render()};
 $("#record-form").addEventListener("submit",saveRecord);$("#student-form").addEventListener("submit",saveStudent);
 $("#record-repeat").addEventListener("change",updateRecordRepeatUI);
 $("#record-date").addEventListener("change",()=>{
  if(state.editing)return;
  const day=((parseDate($("#record-date").value).getDay()+6)%7)+1;
  if(!$$("#record-weekdays input:checked").length)
   $$("#record-weekdays input").forEach(el=>el.checked=Number(el.value)===day);
 });
 $("#request-form").addEventListener("submit",submitRequest);
 document.addEventListener("submit",e=>{if(e.target.id==="invite-form")saveInvite(e)});
 $("#workspace-start").onclick=()=>showModal("account-modal");
 $("#workspace-create").onclick=()=>saveMyWorkspace(false);
 $("#workspace-rename").onclick=()=>saveMyWorkspace(true);
 $("#parent-teacher-select").onchange=()=>{state.parentTeacherFilter=$("#parent-teacher-select").value;render()};
 $("#profile-button").onclick=()=>showModal("account-modal");
 $("#account-action").onclick=()=>showModal("account-modal");
 $("#go-live").onclick=()=>showModal("account-modal");
 $("#google-login").onclick=googleLogin;$("#demo-login").onclick=toggleDemo;$("#sign-out").onclick=signOut;
 $("#demo-reset").onclick=()=>{if(state.mode!=="demo")return;if(!confirm("將清除這台瀏覽器的 V2 測試課程與測試付款紀錄，重新載入範例資料。確定？"))return;
  localStorage.removeItem(STORAGE);loadDemo();render();closeModal("account-modal");toast("預覽已重置，可以測試跨月與部分付款");
 };
 $("#role-teacher").onclick=()=>setRole("teacher");$("#role-parent").onclick=()=>setRole("parent");
 $$(".modal").forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close()}));
}
function moveMonth(offset){state.month=new Date(state.month.getFullYear(),state.month.getMonth()+offset,1);render()}
function main(){if(state.mode==="demo"){loadDemo();loadTeacherPreferences()}else for(const k of LIVE_FIELDS)state[k]=[];bindEvents();render();if(state.mode==="live")initializeLive();else showModal("account-modal")}
main();
