// V3.3 shared course planner smoke/security regressions (no production writes).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const moduleFns=(path,names)=>new Function(read(path).replace(/^export /gm,"")+"\nreturn {"+names.join(",")+"};")();
const libs={
 ...moduleFns("../v2/scheduling.js",["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...moduleFns("../v2/payment-ledger.js",["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...moduleFns("../v2/calendar-view.js",["monthAgendaMarkup","monthSummary"]),
 ...moduleFns("../v2/lesson-actual.js",["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const source=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
function harness(){
 const nodes=new Map(),store=new Map(),shown=[];
 const node=(id)=>{
  if(!nodes.has(id))nodes.set(id,{
   id,value:"",textContent:"",innerHTML:"",style:{},dataset:{},readOnly:false,
   checked:false,disabled:false,open:false,
   classList:{s:new Set(),add(x){this.s.add(x)},remove(x){this.s.delete(x)},
    toggle(x,v){if(v===undefined)v=!this.s.has(x);v?this.s.add(x):this.s.delete(x);return v},
    contains(x){return this.s.has(x)}},
   setAttribute(){},addEventListener(){},showModal(){this.open=true;shown.push(id)},close(){this.open=false}
  });
  return nodes.get(id);
 };
 const document={querySelector:node,querySelectorAll:()=>[],activeElement:null,addEventListener(){}};
 const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const app=new Function("document","localStorage","crypto","confirm","console","setTimeout","FormData","window",...Object.keys(libs),
  source+"\nreturn {state,renderSharedPlanner,sharedCourseStudents,sharedCourseLessons,openSharedCourseForm,submitSharedCourse,"+
  "cancelSharedCourse,setUser(v){activeUser=v},setClient(v){client=v}}")(
  document,localStorage,{randomUUID:()=> "test-id"},()=>true,console,()=>0,FormData,{},...Object.values(libs));
 return {app,node,shown};
}
test("parent and student have accessible shared planner, single and recurring course actions",()=>{
 const html=read("../v2/index.html");
 for(const id of ["shared-parent-card","shared-student-card","shared-course-modal","shared-course-form","shared-course-date",
  "shared-course-frequency","shared-course-weekdays","shared-course-student"]){
  assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
 }
 const app=read("../v2/app.js");
 for(const action of ["shared-new-lesson","shared-new-schedule","shared-edit-lesson",
  "shared-edit-schedule","shared-cancel-lesson","shared-cancel-future","shared-cancel-all"]){
  assert.ok(app.includes(action),action);
 }
});
test("student uses sanitized personal portal and does not see other student courses",()=>{
 const {app,node}=harness();
 app.state.mode="live";app.state.role="student";
 app.setUser({id:"student-user",email:"student@test.example"});
 app.state.studentPortal={
  students:[{id:"mine",name:"我是學生",subject:"數學"}],
  lessons:[{id:"own-lesson",student_id:"mine",lesson_date:"2026-11-02",subject:"數學",start_time:"18:00",end_time:"20:00",type:"planned"},
   {id:"not-mine",student_id:"other",lesson_date:"2026-11-03",subject:"英文",start_time:"18:00",end_time:"20:00",type:"planned"}],
  schedules:[],exceptions:[]};
 assert.deepEqual(app.sharedCourseStudents().map(s=>s.id),["mine"]);
 assert.deepEqual(app.sharedCourseLessons().map(l=>l.id),["own-lesson"]);
 app.renderSharedPlanner();
 const html=node("#shared-student-content").innerHTML;
 assert.ok(html.includes("我是學生")&&html.includes("own-lesson"));
 assert.ok(!html.includes("not-mine")&&!html.includes("NT$"));
 assert.ok(node("#shared-parent-card").classList.contains("hidden"));
});
test("linked parent can open a shared lesson form and cannot choose unrelated student",()=>{
 const {app,node,shown}=harness();
 app.state.mode="live";app.state.role="parent";
 app.setUser({id:"parent1"});
 app.state.students=[{id:"student1",teacher_id:"teacher1",name:"小明",subject:"數學",hourly_rate:500},
  {id:"student2",teacher_id:"teacher2",name:"別人家",subject:"數學",hourly_rate:999}];
 app.state.guardians=[{student_id:"student1",teacher_id:"teacher1",guardian_id:"parent1"}];
 app.openSharedCourseForm("new-lesson");
 assert.ok(shown.includes("#shared-course-modal"));
 assert.ok(node("#shared-course-student").innerHTML.includes("student1"));
 assert.ok(!node("#shared-course-student").innerHTML.includes("student2"));
 assert.equal(app.state.sharedCourseDraft.action,"create_lesson");
});
test("shared course submit invokes authenticated RPC without owner or hourly rate",async()=>{
 const {app,node}=harness();
 app.state.mode="live";app.state.role="student";
 app.setUser({id:"user1"});
 app.state.studentPortal={students:[{id:"mine",name:"小明",subject:"數學"}],lessons:[],schedules:[]};
 app.state.sharedCourseDraft={action:"create_lesson",targetId:null,studentId:"mine"};
 node("#shared-course-student").value="mine";
 node("#shared-course-date").value="2026-11-02";
 node("#shared-course-subject").value="數學";
 node("#shared-course-start").value="18:00";
 node("#shared-course-end").value="20:00";
 const calls=[];
 app.setClient({rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:{ok:true}}}});
 await app.submitSharedCourse({preventDefault(){}});
 assert.equal(calls[0].name,"shared_course_action");
 assert.equal(calls[0].args.p_action,"create_lesson");
 assert.equal(calls[0].args.p_student_id,"mine");
 assert.ok(!("hourly_rate" in calls[0].args.p_payload));
 assert.ok(!("owner_id" in calls[0].args.p_payload));
});
test("server migration checks student/guardian linkage and financial locks",()=>{
 const sql=read("../supabase/migrations/20261021030000_v33_shared_course_management.sql");
 for(const fragment of ["public.student_guardians","public.student_links","v_st.teacher_id=v_actor",
  "public.payment_batch_items","public.family_requests","v_l.type<>'planned'",
  "raise exception '不支援的操作'","revoke all on function public.shared_course_action",
  "insert into tutor_private.shared_course_events"]){
  assert.ok(sql.includes(fragment),fragment);
 }
 const portal=sql.slice(sql.indexOf("create or replace function public.student_portal_data()"));
 for(const secret of ["'hourly_rate'","'total_amount'","'payment_date'","'received_date'"]){
  assert.ok(!portal.includes(secret),"Student portal leaked "+secret);
 }
});
