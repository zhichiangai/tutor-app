
/* 好好上課 V2 · GitHub Pages + Supabase (live) / browser-only (preview).
 * Only the public Supabase URL/publishable key appear here. Never store service_role keys.
 */
const SUPABASE_URL = "https://vctisuglfoxyuwlvyjee.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QR8An_jEnMEZTPuTHebFDA_xg46FLit";
const STORAGE = "tutor_v2_preview_data_20261019";
const ROLE_STORAGE = "tutor_v2_role";
const MODE_STORAGE = "tutor_v2_mode";
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
let client=null, activeUser=null, loading=false;
const state={mode:localStorage.getItem(MODE_STORAGE)==="live"?"live":"demo",role:localStorage.getItem(ROLE_STORAGE)==="parent"?"parent":"teacher",view:"home",month:new Date(new Date().getFullYear(),new Date().getMonth(),1),selected:dateKey(tick()),students:[],lessons:[],invites:[],guardians:[],requests:[],editing:null};

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
  lessons.push({id:"demo-l"+counter++,owner_id:"demo-teacher",student_id:st.id,student:st.name,subject:st.subject,lesson_date:dateKey(d),start_time:((i%2)?"18:00":"19:00"),end_time:((i%2)?"19:30":"20:30"),hours:1.5,hourly_rate:st.hourly_rate,total_amount:st.hourly_rate*1.5,type:passed?"lesson":"planned",status:passed?(i%3===0?"老師已收到":"未付款"):"未付款",remarks:passed?"今日複習重點觀念，進度很穩定。":"",focus_rating:4,attitude_rating:5});
 }
 const upcoming=[1,3,6].map((offset,i)=>{const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset),st=demoStudents[i];return {id:"demo-f"+i,owner_id:"demo-teacher",student_id:st.id,student:st.name,subject:st.subject,lesson_date:dateKey(d),start_time:i===0?"19:00":"18:00",end_time:i===0?"20:30":"19:30",hours:1.5,hourly_rate:st.hourly_rate,total_amount:st.hourly_rate*1.5,type:"planned",status:"未付款",remarks:""}});
 return {students:demoStudents,lessons:[...lessons,...upcoming],invites:[],guardians:demoStudents.map(s=>({student_id:s.id,guardian_id:"demo-parent",teacher_id:"demo-teacher"})),requests:[]};
}
function saveDemo(){if(state.mode==="demo")localStorage.setItem(STORAGE,JSON.stringify({students:state.students,lessons:state.lessons,invites:state.invites,guardians:state.guardians,requests:state.requests}))}
function loadDemo(){try{const o=JSON.parse(localStorage.getItem(STORAGE)||"null")||seed();for(const k of ["students","lessons","invites","guardians","requests"])state[k]=Array.isArray(o[k])?o[k]:[];}catch{Object.assign(state,seed());}saveDemo();}
function visibleStudents(){
 if(state.role==="teacher")return state.students.filter(s=>state.mode==="demo"||s.teacher_id===activeUser?.id);
 const allowed=new Set(state.guardians.filter(g=>state.mode==="demo"||g.guardian_id===activeUser?.id).map(g=>g.student_id));
 return state.students.filter(s=>allowed.has(s.id));
}
function visibleLessons(){
 const allowed=new Set(visibleStudents().map(s=>s.id));
 return state.lessons.filter(l=>allowed.has(l.student_id) && (state.role==="parent"||state.mode==="demo"||l.owner_id===activeUser?.id));
}
function studentFor(lesson){return state.students.find(s=>s.id===lesson.student_id)}
function isPast(s){return s<dateKey(tick())}
function typeLabel(l){return l.type==="leave"?"已請假":l.type==="planned"?"預排課程":"已上課"}
function statusLabel(l){return l.type==="leave"?"請假":l.type==="planned"?"尚未上課":l.status||"未付款"}
function pillClass(l){return l.type==="leave"?"leave":l.type==="planned"?"":l.status==="老師已收到"?"paid":l.status==="家長已付款"?"pending":""}
function lessonSum(list){return list.filter(l=>l.type==="lesson").reduce((v,l)=>v+num(l.total_amount),0)}
function monthLessons(){return visibleLessons().filter(l=>sameMonth(l.lesson_date,state.month))}
function hourTotal(list){return list.filter(l=>l.type==="lesson").reduce((v,l)=>v+num(l.hours),0)}
function toast(message){const box=$("#toast");box.textContent=message;box.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,3500)}
function setBusy(yes){loading=yes;$$("button[type=submit]").forEach(el=>el.disabled=yes)}
function showModal(id){const dialog=$("#"+id);if(dialog&&!dialog.open)dialog.showModal()}
function closeModal(id){const dialog=$("#"+id);if(dialog?.open)dialog.close()}
function setView(view){state.view=view;$$(".page-view").forEach(x=>x.classList.toggle("hidden",x.id!=="view-"+view));$$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("#breadcrumb-name").textContent=({home:"今天",calendar:"課程月曆",billing:"收付款",students:"學生與家長"})[view];render()}
function setRole(role){state.role=role;localStorage.setItem(ROLE_STORAGE,role);setView("home");toast(role==="teacher"?"已切換到老師檢視":"已切換到家長檢視")}
function render(){
 const role=state.role,teacher=role==="teacher";
 $("#greeting-title").innerHTML=teacher?"把每一堂課，<em>好好記下來。</em>":"每個成長時刻，<em>都值得珍惜。</em>";
 $("#greeting-copy").textContent=teacher?"從課程到收款，讓重要的小事都有自己的位置。":"孩子的上課安排、請假和付款，打開就能看見。";
 $("#top-add").style.display=teacher?"":"none";
 $("#demo-banner").classList.toggle("hidden",state.mode!=="demo");
 $("#connection-status").classList.toggle("live",state.mode==="live"&&!!activeUser);
 $("#connection-status").innerHTML=state.mode==="demo"?"<i></i> 體驗模式":activeUser?"<i></i> 已安全連線":"<i></i> 尚未登入";
 $("#account-label").textContent=activeUser?.email?activeUser.email.split("@")[0]:"預覽使用者";
 $("#account-subtitle").textContent=state.mode==="demo"?"體驗模式":activeUser?.email||"尚未登入";
 $("#avatar").textContent=activeUser?.email?.charAt(0).toUpperCase()||"好";
 $("#role-teacher").classList.toggle("active",teacher);
 $("#role-parent").classList.toggle("active",!teacher);
 const ls=monthLessons(),done=ls.filter(l=>l.type==="lesson"),pending=done.filter(l=>l.status!=="老師已收到");
 const completed=done.filter(l=>l.status==="老師已收到");
 const metrics=teacher?[
 ["本月已完成","◷",String(done.length),"<small>堂課</small>","繼續累積每一份努力"],
 ["本月上課時數","☷",hourTotal(ls).toFixed(1),"<small>小時</small>","依已完成課程計算"],
 ["尚待收款","◈",money(lessonSum(pending)),"","未完成收款的課程"]]:[
 ["本月已完成","◷",String(done.length),"<small>堂課</small>","查看孩子的學習足跡"],
 ["本月上課時數","☷",hourTotal(ls).toFixed(1),"<small>小時</small>","依已完成課程計算"],
 ["待確認費用","◈",money(lessonSum(pending)),"","依課程付款狀態計算"]];
 $("#metrics").innerHTML=metrics.map(([label,icon,value,unit,foot])=>'<article class="metric-card"><div class="metric-label">'+label+'</div><div class="metric-icon">'+icon+'</div><div class="metric-value">'+esc(value)+(unit||"")+'</div><div class="metric-footer">'+foot+'</div></article>').join("");
 $("#money-reminder").textContent=teacher?"本月已確認收到 "+money(lessonSum(completed))+"。":"目前有 "+pending.length+" 筆課程等待付款或收款確認。";
 renderNext();renderRecent();renderMiniCalendar();renderFullCalendar();renderBilling();renderStudents();
}
function rowHTML(l,full=false){
 const s=studentFor(l),name=s?.name||l.student||"學生",p=pillClass(l);
 const actions=state.role==="teacher"?(
  (l.type==="planned"?'<button class="mini-action" data-action="complete" data-id="'+esc(l.id)+'">完成上課</button>':"")+
  (l.type==="lesson"&&l.status!=="老師已收到"?'<button class="mini-action" data-action="received" data-id="'+esc(l.id)+'">確認收款</button>':"")+
  (full?'<button class="mini-action" data-action="edit" data-id="'+esc(l.id)+'">編輯</button><button class="mini-action" data-action="cancel-lesson" data-id="'+esc(l.id)+'">請假</button>':"")
 ):(l.type==="planned"||l.type==="lesson"?'<button class="mini-action" data-action="leave-request" data-id="'+esc(l.id)+'">請假</button>':"");
 const pay=state.role==="parent" && l.type==="lesson"&&l.status==="未付款"?'<button class="mini-action" data-action="payment-request" data-id="'+esc(l.id)+'">我已付款</button>':"";
 return '<div class="lesson-row"><span class="lesson-color '+(p==="paid"?"sage":"")+'"></span><div class="lesson-main"><strong>'+esc(name)+' · '+esc(l.subject||s?.subject||"課程")+'</strong><small>'+prettyDate(l.lesson_date)+' · '+esc(timeLabel(l.start_time))+'–'+esc(timeLabel(l.end_time))+'</small></div><div class="row-actions"><span class="pill '+p+'">'+esc(statusLabel(l))+'</span>'+(full?'<span class="lesson-amount">'+money(l.type==="lesson"?l.total_amount:0)+'</span>':"")+actions+pay+'</div></div>';
}
function renderNext(){
 const next=visibleLessons().filter(l=>l.type==="planned"&&l.lesson_date>=dateKey(tick())).sort((a,b)=>(a.lesson_date+" "+a.start_time).localeCompare(b.lesson_date+" "+b.start_time))[0];
 $("#next-lesson").innerHTML=next?'<h2 class="next-heading">'+esc((studentFor(next)?.name||next.student||"學生")+' · '+next.subject)+'</h2><div class="next-meta"><span class="date-tag">'+prettyDate(next.lesson_date)+'</span><span>'+esc(timeLabel(next.start_time))+' – '+esc(timeLabel(next.end_time))+'</span></div><div class="next-actions"><button class="button-outline" data-view="calendar" data-date="'+esc(next.lesson_date)+'">查看這一天 ↗</button>'+(state.role==="teacher"?'<button class="text-link" data-action="complete" data-id="'+esc(next.id)+'">完成上課</button>':'<button class="text-link" data-action="leave-request" data-id="'+esc(next.id)+'">我要請假</button>')+'</div>':'<div class="empty">目前沒有即將開始的課程。<br>慢慢來，也是一種很好的節奏。</div>';
}
function renderRecent(){
 const rows=visibleLessons().filter(l=>l.type!=="leave").sort((a,b)=>(b.lesson_date+" "+b.start_time).localeCompare(a.lesson_date+" "+a.start_time)).slice(0,4);
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
  return '<div class="calendar-cell '+(d.getMonth()!==state.month.getMonth()?"outside ":"")+(state.selected===day?"selected ":"")+(items.length?"has-events":"")+'" data-day="'+day+'" role="button" tabindex="0" aria-label="'+prettyDate(day)+' '+items.length+'堂課"><div class="day-number '+(day===dateKey(tick())?"today":"")+'">'+d.getDate()+'</div>'+items.slice(0,2).map(l=>'<div class="calendar-event '+(l.type==="leave"?"leave":l.type==="lesson"?"done":"")+'">'+esc(l.subject||"課程")+' '+esc(timeLabel(l.start_time))+'</div>').join("")+(items.length>2?'<div class="more-count">＋'+(items.length-2)+' 堂</div>':"")+'</div>';
 }).join("");
 $("#selected-date-title").textContent=prettyDate(state.selected)+" 的課程";
 const rows=ls.filter(l=>l.lesson_date===state.selected).sort((a,b)=>asText(a.start_time).localeCompare(asText(b.start_time)));
 $("#agenda-list").innerHTML=rows.length?rows.map(l=>rowHTML(l,true)).join(""):'<div class="empty">這天目前還沒有課程，可以好好休息一下。</div>';
 $("#agenda-add").style.display=state.role==="teacher"?"":"none";
}
function renderBilling(){
 const ls=monthLessons().filter(l=>l.type==="lesson"),unpaid=ls.filter(l=>l.status!=="老師已收到"),paid=ls.filter(l=>l.status==="老師已收到");
 $("#billing-title").textContent=state.role==="teacher"?"收付款整理":"付款與對帳";
 $("#billing-month").textContent=state.month.getFullYear()+"年 "+(state.month.getMonth()+1)+"月";
 $("#billing-summary").innerHTML=[
  ["本月應收","◈",money(lessonSum(ls))],["已確認收款","✓",money(lessonSum(paid))],["待確認","◷",money(lessonSum(unpaid))]
 ].map(([label,icon,value])=>'<div class="metric-card"><span class="metric-label">'+label+'</span><span class="metric-icon">'+icon+'</span><div class="metric-value">'+value+'</div></div>').join("");
 $("#billing-list").innerHTML=ls.length?ls.sort((a,b)=>a.lesson_date.localeCompare(b.lesson_date)).map(l=>rowHTML(l,true)).join(""):'<div class="empty">這個月份還沒有已完成的課程費用。</div>';
 const reqs=state.requests.filter(r=>state.role==="teacher"?(state.mode==="demo"||r.teacher_id===activeUser?.id):(state.mode==="demo"||r.parent_id===activeUser?.id))
  .sort((a,b)=>(a.status==="pending"?0:1)-(b.status==="pending"?0:1)||(b.created_at||"").localeCompare(a.created_at||""));
 $("#requests-list").innerHTML=reqs.length?reqs.map(r=>{const student=state.students.find(s=>s.id===r.student_id),lesson=state.lessons.find(l=>l.id===r.lesson_id),tag=r.status==="pending"?"待確認":r.status==="approved"?"已同意":"未同意";
 return '<div class="request-row"><span class="lesson-color '+(r.status==="approved"?"sage":"")+'"></span><div class="lesson-main"><strong>'+esc(student?.name||"學生")+' · '+(r.kind==="leave"?"請假申請":"付款回報")+'</strong><small>'+esc(lesson?.lesson_date||"")+' '+esc(r.note||"")+'</small></div><span class="pill '+(r.status==="approved"?"paid":r.status==="pending"?"pending":"")+'">'+tag+'</span>'+(state.role==="teacher"&&r.status==="pending"?'<button class="mini-action" data-action="approve-request" data-id="'+esc(r.id)+'">同意</button><button class="mini-action" data-action="decline-request" data-id="'+esc(r.id)+'">不接受</button>':"")+'</div>'}).join(""):'<div class="empty">目前沒有需要處理的申請。</div>';
}
function renderStudents(){
 const st=visibleStudents();
 $("#add-student").style.display=state.role==="teacher"?"":"none";
 $("#student-grid").innerHTML=st.length?st.map(s=>'<article class="student-card"><div class="student-icon">✿</div><h3>'+esc(s.name)+'</h3><p>'+esc(s.subject||"課程")+' · '+money(s.hourly_rate)+'／小時</p><div class="tag-line">已安排 '+visibleLessons().filter(l=>l.student_id===s.id).length+' 堂課</div></article>').join(""):'<div class="card empty">目前沒有學生資料。'+(state.role==="parent"?"請先接受老師的邀請。":"先新增一位學生吧。")+'</div>';
 const parent=state.role==="parent";$("#invite-title").textContent=parent?"家長邀請":"邀請家長加入";$("#invite-description").textContent=parent?"老師邀請你後，可以在這裡確認連結。":"輸入家長的 Google 帳號 Email，登入後即可取得孩子的課程檢視權限。";
 if(parent){
  const connected=new Set(state.guardians.map(g=>g.student_id));
  const invites=state.invites.filter(i=>state.mode==="demo"||i.email===activeUser?.email?.toLowerCase());
  $("#invite-content").innerHTML=invites.length?invites.map(i=>'<div class="request-row"><div class="lesson-main"><strong>'+esc(state.students.find(s=>s.id===i.student_id)?.name||"學生邀請")+'</strong><small>'+esc(i.email)+'</small></div>'+(connected.has(i.student_id)?'<span class="pill paid">已加入</span>':'<button class="secondary-button" data-action="accept-invite" data-id="'+esc(i.id)+'">接受邀請</button>')+'</div>').join(""):'<div class="empty">尚未收到邀請。請老師使用你 Google 帳號的 Email 發送邀請。</div>';
 }else{
  $("#invite-content").innerHTML=st.length?'<form class="invite-form" id="invite-form"><label>選擇學生<select id="invite-student">'+st.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+'</select></label><label>家長的 Google Email<input id="invite-email" type="email" required placeholder="parent@gmail.com" autocomplete="email"></label><button type="submit" class="primary-button">建立邀請</button></form><div class="invite-list">'+state.invites.map(i=>'<div class="lesson-row"><div class="lesson-main"><strong>'+esc(i.email)+'</strong><small>'+esc(st.find(s=>s.id===i.student_id)?.name||"學生")+'</small></div><span class="pill">已建立邀請</span></div>').join("")+'</div>':'<div class="empty">新增學生後，就可以邀請家長共同查看課程。</div>';
 }
}
function openRecord(lesson=null){
 if(state.role!=="teacher"){toast("只有老師能安排課程");return}
 const st=visibleStudents();if(!st.length){toast("請先新增學生，再安排課程");showModal("student-modal");return}
 state.editing=lesson?.id||null;
 $("#record-modal-title").textContent=lesson?"編輯課程":"新增一堂課";
 $("#record-student").innerHTML=st.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("");
 $("#record-student").value=lesson?.student_id||st[0].id;
 const s=st.find(s=>s.id===$("#record-student").value);
 $("#record-subject").value=lesson?.subject||s?.subject||"數學";
 $("#record-rate").value=lesson?.hourly_rate??s?.hourly_rate??500;
 $("#record-date").value=lesson?.lesson_date||state.selected;
 $("#record-start").value=timeLabel(lesson?.start_time||"19:00");
 $("#record-end").value=timeLabel(lesson?.end_time||"20:30");
 $("#record-remarks").value=lesson?.remarks||"";
 $("#record-repeat").value="none";
 $("#repeat-label").classList.toggle("hidden",!!lesson);
 showModal("record-modal");
}
function scheduleDates(day,repeat){
 const first=parseDate(day),out=[day],limit=4;
 for(let i=1;i<limit&&repeat!=="none";i++){
  let d;
  if(repeat==="monthly"){const wanted=first.getDate(),last=new Date(first.getFullYear(),first.getMonth()+i+1,0).getDate();d=new Date(first.getFullYear(),first.getMonth()+i,Math.min(wanted,last))}
  else d=new Date(first.getFullYear(),first.getMonth(),first.getDate()+(repeat==="weekly"?7:14)*i);
  out.push(dateKey(d));
 }
 return out;
}
async function persist(op){
 if(loading)return false;setBusy(true);
 try{await op();if(state.mode==="demo")saveDemo();else await refreshLive();render();return true}
 catch(err){console.error(err);toast("操作未完成："+(err.message||"請稍後再試"));return false}
 finally{setBusy(false)}
}
function assertResult({error,data}){if(error)throw error;return data}
async function saveRecord(ev){
 ev.preventDefault();if(state.role!=="teacher")return;
 const s=visibleStudents().find(x=>x.id===$("#record-student").value);
 if(!s){toast("請選擇學生");return}
 const date=$("#record-date").value,start=$("#record-start").value,end=$("#record-end").value,rate=num($("#record-rate").value);
 const hours=(Number(end.slice(0,2))*60+Number(end.slice(3)) - Number(start.slice(0,2))*60-Number(start.slice(3)))/60;
 if(hours<=0||hours>16){toast("請確認上課結束時間晚於開始時間");return}
 const common={student_id:s.id,student:s.name,subject:$("#record-subject").value.trim(),start_time:start,end_time:end,hours:Math.round(hours*100)/100,hourly_rate:rate,total_amount:Math.round(hours*rate*100)/100,remarks:$("#record-remarks").value.trim()};
 if(!common.subject){toast("請填寫科目");return}
 const edited=state.lessons.find(l=>l.id===state.editing);
 if(edited){
  const item={...common,lesson_date:date};
  const ok=await persist(async()=>{if(state.mode==="demo")Object.assign(edited,item);else assertResult(await client.from("lesson_records").update(item).eq("id",edited.id))});if(ok){closeModal("record-modal");toast("課程已更新")}return;
 }
 const dates=scheduleDates(date,$("#record-repeat").value);
 const records=dates.map(day=>({...common,lesson_date:day,type:day<dateKey(tick())?"lesson":"planned",status:"未付款",owner_id:activeUser?.id||"demo-teacher"}));
 const ok=await persist(async()=>{if(state.mode==="demo"){state.lessons.push(...records.map(x=>({...x,id:uid()})))}else assertResult(await client.from("lesson_records").insert(records))});
 if(ok){closeModal("record-modal");toast("已新增 "+records.length+" 堂課")}
}
async function saveStudent(ev){
 ev.preventDefault();if(state.role!=="teacher")return;
 const form=new FormData(ev.target),name=asText(form.get("name")).trim(),subject=asText(form.get("subject")).trim(),rate=num(form.get("hourly_rate"));
 if(!name)return;const data={name,subject,hourly_rate:rate,teacher_id:activeUser?.id||"demo-teacher"};
 const ok=await persist(async()=>{if(state.mode==="demo")state.students.push({id:uid(),...data});else assertResult(await client.from("students").insert(data))});if(ok){closeModal("student-modal");ev.target.reset();toast("已新增學生")}
}
async function saveInvite(ev){
 ev.preventDefault();if(state.role!=="teacher")return;
 const student_id=$("#invite-student").value,email=$("#invite-email").value.trim().toLowerCase(),data={student_id,email,teacher_id:activeUser?.id||"demo-teacher"};
 const ok=await persist(async()=>{if(state.mode==="demo"){if(state.invites.some(i=>i.student_id===student_id&&i.email===email))throw Error("這位家長已在邀請清單中");state.invites.push({id:uid(),...data})}else assertResult(await client.from("guardian_invites").insert(data))});
 if(ok){$("#invite-email").value="";toast("已建立邀請，請家長登入後接受")}
}
async function updateLesson(id,patch,msg){
 const item=state.lessons.find(l=>l.id===id);if(!item)return;
 const ok=await persist(async()=>{if(state.mode==="demo")Object.assign(item,patch);else assertResult(await client.from("lesson_records").update(patch).eq("id",id))});
 if(ok)toast(msg);
}
function openRequest(id,kind){
 const l=state.lessons.find(x=>x.id===id);if(!l)return;
 $("#request-lesson-id").value=l.id;$("#request-kind").value=kind;$("#request-note").value="";
 $("#request-heading").textContent=kind==="leave"?"提出請假":"回報已付款";
 $("#request-description").textContent=(studentFor(l)?.name||"學生")+" · "+prettyDate(l.lesson_date)+"｜"+(kind==="leave"?"請假需要老師確認，不會立即取消課程。":"確認付款後，還需要老師核對收款。");
 showModal("request-modal");
}
async function submitRequest(ev){
 ev.preventDefault();const id=$("#request-lesson-id").value,l=state.lessons.find(x=>x.id===id);if(!l)return;
 if(state.role!=="parent"){toast("切換家長模式後才能申請");return}
 const kind=$("#request-kind").value;
 if(state.requests.some(r=>r.lesson_id===id&&r.kind===kind&&r.status==="pending")){toast("這堂課已經有待確認的申請");return}
 const data={lesson_id:l.id,student_id:l.student_id,teacher_id:l.owner_id,parent_id:activeUser?.id||"demo-parent",kind,note:$("#request-note").value.trim(),status:"pending"};
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
  if(state.mode==="demo"){r.status=newStatus;r.reviewed_at=new Date().toISOString()}
  else assertResult(await client.from("family_requests").update({status:newStatus,reviewed_at:new Date().toISOString()}).eq("id",id));
  if(approve&&r.lesson_id){
   const patch=r.kind==="leave"?{type:"leave"}:{status:"家長已付款",payment_date:dateKey(tick())};
   if(state.mode==="demo")Object.assign(state.lessons.find(l=>l.id===r.lesson_id)||{},patch);
   else assertResult(await client.from("lesson_records").update(patch).eq("id",r.lesson_id));
  }
 });if(ok)toast(approve?"已同意申請":"已婉拒申請");
}
async function refreshLive(){
 if(!client||!activeUser)return;
 const tables=["students","lesson_records","guardian_invites","student_guardians","family_requests"];
 const results=await Promise.all(tables.map(t=>client.from(t).select("*").limit(1000)));
 results.forEach((res,i)=>{if(res.error)throw Error(tables[i]+": "+res.error.message);});
 [state.students,state.lessons,state.invites,state.guardians,state.requests]=results.map(r=>r.data||[]);
}
async function ensureClient(){
 if(client)return client;
 const {createClient}=await import("https://esm.sh/@supabase/supabase-js@2.76.1");
 client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 client.auth.onAuthStateChange((event,session)=>{activeUser=session?.user||null;if(event==="SIGNED_OUT"){state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();}});
 return client;
}
async function initializeLive(){
 try{
  await ensureClient();const {data,error}=await client.auth.getSession();if(error)throw error;
  activeUser=data.session?.user||null;if(activeUser){await refreshLive();toast("已登入並同步課程")}else{for(const k of ["students","lessons","invites","guardians","requests"])state[k]=[];}
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
 activeUser=null;state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();closeModal("account-modal");toast("已登出，目前使用預覽模式");
}
function toggleDemo(){
 activeUser=null;state.mode="demo";localStorage.setItem(MODE_STORAGE,"demo");loadDemo();render();closeModal("account-modal");toast("現在可以自由試用，不影響正式資料");
}
function bindEvents(){
 document.addEventListener("click",async ev=>{
  const nav=ev.target.closest("[data-view]");if(nav){setView(nav.dataset.view);if(nav.dataset.date){state.selected=nav.dataset.date;state.month=parseDate(state.selected);render()}return}
  const close=ev.target.closest("[data-close]");if(close){closeModal(close.dataset.close);return}
  const day=ev.target.closest("[data-day]");if(day){state.selected=day.dataset.day;renderFullCalendar();return}
  const action=ev.target.closest("[data-action]");if(action){
   const id=action.dataset.id,kind=action.dataset.action;
   if(kind==="complete")await updateLesson(id,{type:"lesson"},"已完成上課");
   if(kind==="received")await updateLesson(id,{status:"老師已收到",received_date:dateKey(tick())},"已確認收款");
   if(kind==="edit")openRecord(state.lessons.find(l=>l.id===id));
   if(kind==="cancel-lesson")if(confirm("確認將這堂課標記為請假？"))await updateLesson(id,{type:"leave",leave_source:"teacher"},"已標記為請假");
   if(kind==="leave-request")openRequest(id,"leave");
   if(kind==="payment-request")openRequest(id,"payment");
   if(kind==="accept-invite")await acceptInvite(id);
   if(kind==="approve-request")await reviewRequest(id,true);
   if(kind==="decline-request")await reviewRequest(id,false);
  }
 });
 document.addEventListener("keydown",ev=>{const el=ev.target.closest("[data-day]");if(el&&(ev.key==="Enter"||ev.key===" ")){ev.preventDefault();state.selected=el.dataset.day;renderFullCalendar()}});
 $("#top-add").onclick=()=>openRecord();
 $("#agenda-add").onclick=()=>openRecord();
 $("#add-student").onclick=()=>showModal("student-modal");
 $("#record-student").onchange=()=>{if(state.editing)return;const s=visibleStudents().find(s=>s.id===$("#record-student").value);if(s){$("#record-subject").value=s.subject;$("#record-rate").value=s.hourly_rate}};
 $("#prev-month").onclick=()=>moveMonth(-1);$("#next-month").onclick=()=>moveMonth(1);
 $("#billing-prev").onclick=()=>moveMonth(-1);$("#billing-next").onclick=()=>moveMonth(1);
 $("#jump-today").onclick=()=>{state.month=new Date(tick().getFullYear(),tick().getMonth(),1);state.selected=dateKey(tick());render()};
 $("#record-form").addEventListener("submit",saveRecord);$("#student-form").addEventListener("submit",saveStudent);
 $("#request-form").addEventListener("submit",submitRequest);
 document.addEventListener("submit",e=>{if(e.target.id==="invite-form")saveInvite(e)});
 $("#profile-button").onclick=()=>showModal("account-modal");
 $("#account-action").onclick=()=>showModal("account-modal");
 $("#go-live").onclick=()=>showModal("account-modal");
 $("#google-login").onclick=googleLogin;$("#demo-login").onclick=toggleDemo;$("#sign-out").onclick=signOut;
 $("#role-teacher").onclick=()=>setRole("teacher");$("#role-parent").onclick=()=>setRole("parent");
 $$(".modal").forEach(d=>d.addEventListener("click",e=>{if(e.target===d)d.close()}));
}
function moveMonth(offset){state.month=new Date(state.month.getFullYear(),state.month.getMonth()+offset,1);render()}
function main(){loadDemo();bindEvents();render();if(state.mode==="live")initializeLive();else showModal("account-modal")}
main();
