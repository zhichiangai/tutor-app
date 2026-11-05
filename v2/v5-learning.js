// V5.3 Team students, enrollments and shared monthly lessons.
// Everything is read with current Supabase Auth/JWT; PostgreSQL RLS is authoritative.
export function createV5LearningUI({getClient,getUser,getRole,isReady,notify}){
 const $=id=>document.getElementById(id);
 const el=(tag,value,cls)=>{
  const x=document.createElement(tag);
  if(value!==undefined)x.textContent=String(value??'');
  if(cls)x.className=cls;
  return x;
 };
 const option=(value,label)=>{
  const x=el('option',label);x.value=value;return x;
 };
 let generation=0,ready=false,busy=false,loading=false,error='';
 let teams=[],managed=[],projects=[],students=[],enrollments=[],assignments=[],lessons=[];
 let teamId='',projectId='',month=new Date();
 month=new Date(month.getFullYear(),month.getMonth(),1);
 let attached=false;
 const valid=()=>Boolean(isReady()&&getUser()?.id&&getRole()==='teacher'&&getClient());
 const isManager=(team=teamId)=>managed.some(t=>t.workspace_id===
  teams.find(x=>x.id===team)?.anchor_workspace_id&&t.manager_user_id===getUser()?.id);
 const teamProjects=()=>projects.filter(p=>p.team_id===teamId);
 const visibleProjects=()=>teamProjects().filter(p=>p.status==='active');
 const projectAssignments=(id=projectId)=>assignments.filter(a=>a.project_id===id);
 const projectEnrollments=(id=projectId)=>enrollments.filter(a=>a.project_id===id);
 const projectStudents=(id=projectId)=>students.filter(s=>
  projectEnrollments(id).some(en=>en.student_id===s.id));
 const currentLessonDate=(date)=>{
  const d=new Date(date);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
   year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const field=k=>parts.find(x=>x.type===k)?.value||'00';
  return [field('year'),field('month'),field('day')].join('-');
 };
 function clear(){
  generation++;teams=[];managed=[];projects=[];students=[];enrollments=[];
  assignments=[];lessons=[];teamId='';projectId='';ready=false;loading=false;busy=false;error='';
  $('v5-learning-card')?.classList.add('hidden');
  for(const id of ['v5-learning-students','v5-learning-calendar','v5-learning-lessons',
   'v5-learning-message'])$(id)?.replaceChildren();
 }
 function syncSelect(id,values,selected){
  const select=$(id);
  if(!select)return;
  select.replaceChildren();
  for(const o of values)select.append(option(o.value,o.label));
  if(values.some(v=>v.value===selected))select.value=selected;
 }
 function projectLabel(id){return projects.find(p=>p.id===id)?.name||'專案'}
 function teacherLabel(id){
  return id===getUser()?.id?'我':'老師 · '+String(id).slice(-6);
 }
 function render(){
  const card=$('v5-learning-card');
  if(!card)return;
  if(!valid()){card.classList.add('hidden');return}
  // Do not show an empty server-failed card on V4-only sites.
  const visible=ready||loading||Boolean(error);
  card.classList.toggle('hidden',!visible);
  if(!visible)return;
  const message=$('v5-learning-message');
  message.textContent=loading?'正在確認 Team 學生與課程資料…':error||
   'Team 的學生與課程獨立於個人家教空間，只有管理者和獲指派的老師能查看。';
  const allowedTeams=teams.filter(t=>isManager(t.id)||
   projects.some(p=>p.team_id===t.id));
  if(!allowedTeams.some(t=>t.id===teamId))teamId=allowedTeams[0]?.id||'';
  syncSelect('v5-learning-team-select',allowedTeams.map(t=>({
   value:t.id,label:'Team · '+t.id.slice(-8)
  })),teamId);
  const possible=visibleProjects();
  if(!possible.some(p=>p.id===projectId))projectId=possible[0]?.id||'';
  syncSelect('v5-learning-project-select',possible.map(p=>({
   value:p.id,label:p.name
  })),projectId);
  const manager=isManager(),owner=$('v5-learning-manager-controls');
  owner.classList.toggle('hidden',!manager);
  const project=$('v5-learning-project-select');
  project.disabled=!possible.length;
  const studentList=$('v5-learning-students');
  studentList.replaceChildren();
  const related=projectStudents();
  if(!projectId)studentList.append(el('p','請先建立或選擇 Team 專案。','section-sub'));
  else if(!related.length)studentList.append(el('p','此專案還沒有學生。','section-sub'));
  for(const s of related){
   const row=el('div',undefined,'v5-learning-row');
   row.append(el('span',s.display_name+(s.is_archived?' · 已封存':'')));
   if(manager&&!s.is_archived){
    const btn=el('button','封存','secondary-button');
    btn.type='button';btn.dataset.v5LearningAction='archive-student';
    btn.dataset.id=s.id;row.append(btn);
   }
   studentList.append(row);
  }
  const teamStudents=students.filter(s=>s.team_id===teamId&&!s.is_archived);
  const available=teamStudents.filter(s=>!projectEnrollments().some(e=>e.student_id===s.id));
  syncSelect('v5-learning-enroll-student',available.map(s=>({
   value:s.id,label:s.display_name
  })),'');
  $('v5-learning-enroll-submit').disabled=busy||!projectId||!available.length;
  const assign=projectAssignments();
  const allowedTeachers=assign.filter(a=>a.user_id===getUser()?.id||manager);
  syncSelect('v5-learning-lesson-student',related.filter(s=>!s.is_archived).map(s=>({
   value:s.id,label:s.display_name
  })),'');
  syncSelect('v5-learning-lesson-teacher',allowedTeachers.map(a=>({
   value:a.user_id,label:teacherLabel(a.user_id)
  })),getUser()?.id);
  const canCreateLesson=Boolean(projectId&&allowedTeachers.length&&
   related.some(s=>!s.is_archived));
  $('v5-learning-lesson-submit').disabled=busy||!canCreateLesson;
  const noData=$('v5-learning-no-project');
  noData.classList.toggle('hidden',Boolean(projectId));
  $('v5-learning-student-form').querySelector('button[type=submit]').disabled=busy||!manager;
  const availableMonth=new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'long'}).format(month);
  $('v5-learning-month-label').textContent=availableMonth;
  renderCalendar();
  renderLessonList();
 }
 function renderCalendar(){
  const target=$('v5-learning-calendar');target.replaceChildren();
  for(const day of ['日','一','二','三','四','五','六']){
   target.append(el('span',day,'v5-learning-weekday'));
  }
  const y=month.getFullYear(),m=month.getMonth();
  const first=new Date(y,m,1),start=first.getDay(),days=new Date(y,m+1,0).getDate();
  const visible=lessons.filter(l=>l.project_id===projectId);
  const dates=new Map();
  for(const lesson of visible){
   const d=currentLessonDate(lesson.lesson_start);
   if(!dates.has(d))dates.set(d,[]);
   dates.get(d).push(lesson);
  }
  for(let i=0;i<start+days;i++){
   const tile=el('div',undefined,'v5-learning-day'+(i<start?' outside':''));
   if(i>=start){
    const day=i-start+1,key=[y,String(m+1).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
    tile.append(el('strong',day));
    for(const lesson of (dates.get(key)||[]).slice(0,3)){
     const b=el('button',new Date(lesson.lesson_start).toLocaleTimeString('zh-TW',{
      timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false
     })+' '+lesson.subject,'v5-learning-event');
     b.type='button';b.dataset.v5LearningAction='select-lesson';b.dataset.id=lesson.id;
     tile.append(b);
    }
    if((dates.get(key)||[]).length>3)
     tile.append(el('small','另有 '+(dates.get(key).length-3)+' 堂'));
   }
   target.append(tile);
  }
 }
 function renderLessonList(){
  const target=$('v5-learning-lessons');target.replaceChildren();
  const visible=lessons.filter(l=>l.project_id===projectId)
   .sort((a,b)=>a.lesson_start.localeCompare(b.lesson_start));
  if(!visible.length)target.append(el('p','這個月沒有已建立的 Team 課程。','section-sub'));
  for(const l of visible){
   const row=el('div',undefined,'v5-learning-lesson-row');
   row.dataset.v5LessonId=l.id;
   const student=students.find(s=>s.id===l.student_id)?.display_name||'學生';
   const start=new Date(l.lesson_start).toLocaleString('zh-TW',{
    timeZone:'Asia/Taipei',month:'numeric',day:'numeric',
    hour:'2-digit',minute:'2-digit',hour12:false
   });
   const end=new Date(l.lesson_end).toLocaleTimeString('zh-TW',{
    timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false
   });
   const head=el('strong',start+'–'+end+' · '+student+' · '+l.subject);
   const status=el('span',(l.status==='completed'?'已完成':
    l.status==='cancelled'?'已取消':'已排課')+' · '+teacherLabel(l.teacher_user_id),
    'section-sub');
   row.append(head,status);
   if(l.notes)row.append(el('p',l.notes,'v5-learning-notes'));
   const able=isManager()||l.teacher_user_id===getUser()?.id&&
    projectAssignments(l.project_id).some(a=>a.user_id===getUser()?.id);
   if(able&&l.status==='scheduled'){
    const actions=el('div',undefined,'v5-learning-lesson-actions');
    for(const [value,label] of [['completed','標記完成'],['cancelled','取消課程']]){
     const btn=el('button',label,'secondary-button');
     btn.type='button';btn.dataset.v5LearningAction='update-lesson';
     btn.dataset.id=l.id;btn.dataset.status=value;actions.append(btn);
    }
    row.append(actions);
   }
   target.append(row);
  }
 }
 function attach(){
  if(attached)return;attached=true;
  $('v5-learning-team-select').addEventListener('change',e=>{
   teamId=e.target.value;projectId='';void refresh();
  });
  $('v5-learning-project-select').addEventListener('change',e=>{
   projectId=e.target.value;render();
  });
  const now=new Date();
  const local=new Date(now.getTime()-now.getTimezoneOffset()*60000)
    .toISOString().slice(0,16);
  const finish=new Date(now.getTime()+60*60000-now.getTimezoneOffset()*60000)
    .toISOString().slice(0,16);
  $('v5-learning-lesson-start').value=local;
  $('v5-learning-lesson-end').value=finish;
  $('v5-learning-prev-month').addEventListener('click',()=>shiftMonth(-1));
  $('v5-learning-next-month').addEventListener('click',()=>shiftMonth(1));
 }
 function shiftMonth(dir){
  month=new Date(month.getFullYear(),month.getMonth()+dir,1);
  void refresh();
 }
 async function refresh(){
  if(!valid()){clear();return}
  attach();
  const token=++generation,id=getUser().id,client=getClient();
  loading=true;error='';render();
  const start=new Date(month.getFullYear(),month.getMonth(),1).toISOString();
  const end=new Date(month.getFullYear(),month.getMonth()+1,1).toISOString();
  try{
   const res=await Promise.all([
    client.from('v5_teams').select('id,anchor_workspace_id'),
    client.rpc('v5_my_managed_teams'),
    client.from('v5_team_projects').select('id,team_id,workspace_id,name,status'),
    client.from('v5_team_students').select('id,team_id,display_name,is_archived,created_by'),
    client.from('v5_team_enrollments').select('team_id,project_id,student_id'),
    client.from('v5_team_project_members').select('workspace_id,project_id,user_id'),
    client.from('v5_team_lessons')
      .select('id,team_id,project_id,student_id,teacher_user_id,subject,lesson_start,lesson_end,status,notes')
      .gte('lesson_start',start).lt('lesson_start',end).order('lesson_start')
      .limit(500)
   ]);
   if(token!==generation||getUser()?.id!==id||!valid())return;
   const problem=res.find(x=>x.error);
   if(problem){
    const msg=problem.error?.message||'';
    error=/PGRST202|PGRST205|relation .* does not exist|404/i.test(msg)?
     'V5.3 Team 資料庫尚未啟用。':'Team 資料暫時無法讀取，請再試一次。';
    ready=false;teams=[];projects=[];students=[];enrollments=[];lessons=[];
   }else{
    [teams,managed,projects,students,enrollments,assignments,lessons]=
     res.map(x=>x.data||[]);
    ready=true;
   }
  }catch{
   if(token!==generation||getUser()?.id!==id||!valid())return;
   error='無法連線 Team 資料，請重新進入設定頁。';ready=false;
  }finally{
   if(token===generation&&getUser()?.id===id&&valid()){
    loading=false;render();
   }
  }
 }
 async function mutation(fn,message){
  if(busy||!valid())return false;
  busy=true;render();
  try{
   const result=await fn();
   if(result.error||Array.isArray(result.data)&&result.data.length===0)
    throw result.error||new Error('No rows were changed');
   notify(message);await refresh();return true;
  }catch(err){
   notify('操作未完成，請確認名額、專案指派與權限。');
   return false;
  }finally{busy=false;render()}
 }
 async function handleSubmit(e){
  const id=e.target?.id;
  if(!['v5-learning-student-form','v5-learning-enroll-form',
    'v5-learning-lesson-form'].includes(id))return false;
  e.preventDefault();
  const client=getClient(),manager=isManager();
  if(!valid()||!ready||!client||!teamId)return true;
  if(id==='v5-learning-student-form'){
   if(!manager)return true;
   const name=$('v5-learning-student-name').value.trim();
   if(name.length<1||name.length>100)return true;
   const success=await mutation(()=>client.from('v5_team_students').insert({
    team_id:teamId,display_name:name,created_by:getUser().id
   }).select('id'),'已新增 Team 學生，請將學生加入指定專案');
   if(success)$('v5-learning-student-name').value='';
  }else if(id==='v5-learning-enroll-form'){
   if(!manager||!projectId)return true;
   const student_id=$('v5-learning-enroll-student').value;
   if(!student_id||!students.some(s=>s.id===student_id&&s.team_id===teamId))return true;
   await mutation(()=>client.from('v5_team_enrollments').insert({
    team_id:teamId,student_id,project_id:projectId
   }).select('student_id'),'學生已加入這個 Team 專案');
  }else{
   if(!projectId)return true;
   const student_id=$('v5-learning-lesson-student').value;
   const teacher_user_id=$('v5-learning-lesson-teacher').value;
   const subject=$('v5-learning-lesson-subject').value.trim();
   const startDate=new Date($('v5-learning-lesson-start').value);
   const endDate=new Date($('v5-learning-lesson-end').value);
   if(!projectStudents().some(s=>s.id===student_id&&!s.is_archived)||
     !projectAssignments().some(a=>a.user_id===teacher_user_id)||
     (!manager&&teacher_user_id!==getUser()?.id)||
     !subject||subject.length>100||
     !Number.isFinite(+startDate)||!Number.isFinite(+endDate)||
     endDate<=startDate)return true;
   const notes=$('v5-learning-lesson-notes').value.trim();
   const success=await mutation(()=>client.from('v5_team_lessons').insert({
    team_id:teamId,project_id:projectId,student_id,teacher_user_id,
    subject,lesson_start:startDate.toISOString(),lesson_end:endDate.toISOString(),
    notes,status:'scheduled'
   }).select('id'),'已建立 Team 課程');
   if(success){
    $('v5-learning-lesson-subject').value='';
    $('v5-learning-lesson-notes').value='';
   }
  }
  return true;
 }
 async function handleClick(target){
  const b=target?.closest?.('[data-v5-learning-action]');
  if(!b)return false;
  if(!valid()||!ready)return true;
  const client=getClient(),action=b.dataset.v5LearningAction,id=b.dataset.id;
  if(action==='archive-student'){
   if(isManager()&&window.confirm('封存後不能再新增此學生的課程，但歷史課程仍保留。')){
    await mutation(()=>client.from('v5_team_students').update({is_archived:true})
     .eq('id',id).eq('team_id',teamId).select('id'),'學生已封存');
   }
  }else if(action==='update-lesson'){
   if(!['completed','cancelled'].includes(b.dataset.status))return true;
   if(window.confirm('確定更新這堂 Team 課程狀態？')){
    await mutation(()=>client.from('v5_team_lessons').update({status:b.dataset.status})
     .eq('id',id).eq('project_id',projectId).select('id'),
    b.dataset.status==='completed'?'課程已標記完成':'課程已取消');
   }
  }else if(action==='select-lesson'){
   const row=$('v5-learning-lessons').querySelector('[data-v5-lesson-id="'+id+'"]');
   row?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  return true;
 }
 return {render,refresh,clear,handleSubmit,handleClick};
}
