// V3.2 Student portal regressions. Uses local mocks only; no live account writes.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const mod=(s,names)=>new Function(s.replace(/^export /gm,"")+"\nreturn {"+names.join(",")+"}")();
const helpers={
 ...mod(read("../v2/scheduling.js"),["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...mod(read("../v2/payment-ledger.js"),["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...mod(read("../v2/calendar-view.js"),["monthAgendaMarkup","monthSummary"]),
 ...mod(read("../v2/lesson-actual.js"),["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const source=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
function appFixture(){
 const items=new Map(),store=new Map();
 const make=id=>({
  id,value:"",innerHTML:"",textContent:"",style:{},dataset:{},checked:false,disabled:false,open:false,
  classList:{set:new Set(),add(k){this.set.add(k)},remove(k){this.set.delete(k)},contains(k){return this.set.has(k)},toggle(k,on){if(on===undefined)on=!this.set.has(k);on?this.set.add(k):this.set.delete(k);return on}},
  addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}
 });
 const get=id=>{if(!items.has(id))items.set(id,make(id));return items.get(id)};
 const document={querySelector:get,querySelectorAll:()=>[],addEventListener(){},createElement:make};
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
 const app=new Function("document","localStorage","crypto","confirm","console","setTimeout","FormData","window",...Object.keys(helpers),
 source+"\nrender=()=>{};return {state,visibleStudents,visibleLessons,displayRoleName,accountDisplayName,setRole,sendStudentInvite,acceptStudentInvite,revokeStudentInvite,refreshStudentPortal,renderStudents,renderStudentInvitationPanels,openLessonPopup,"+
 "setUser(x){activeUser=x},setClient(x){client=x},setRender(x){render=x},setMode(x){state.mode=x}}")(
 document,storage,{randomUUID:()=>String(Math.random())},()=>true,console,()=>0,FormData,{},...Object.values(helpers));
 return {app,get,store};
}
test("Student and name/role controls exist with responsive labels",()=>{
 const html=read("../v2/index.html");
 for(const id of ["role-student","role-indicator-sub","profile-name-form","profile-display-name",
 "student-invitations-card","teacher-student-invitations","teacher-student-invite-form",
 "student-lesson-review","student-invite-edit-modal"])
  assert.ok(html.includes('id="'+id+'"'),id);
 const css=read("../v2/style.css");
 assert.ok(css.includes(".role-indicator-label"));
});
test("Profile name and three role suffixes are independent of Google email",()=>{
 const {app}=appFixture();
 app.state.profiles=[{id:"x",display_name:"XWX",last_role:"student"}];
 app.setUser({id:"x",email:"unrelated@example.org"});
 for(const [role,label] of [["teacher","XWX 老師"],["parent","XWX 家長"],["student","XWX 同學"]]){
  app.state.role=role;assert.equal(app.displayRoleName(),label);
 }
});
test("A new Google account restores the role stored in its server profile first",()=>{
 const source=read("../v2/app.js");
 assert.ok(source.includes('const cloudRole=ROLE_VALUES.includes(profile?.last_role)?profile.last_role:null'));
 assert.ok(source.includes('state.role=cloudRole||'));
 assert.ok(source.includes('writeRolePreference(activeUser.id,state.role)'));
 assert.ok(source.includes('client.from("profiles").update({last_role:role})'));
});
test("Teacher-created student invitations can be accepted and revoked without deleting lessons",async()=>{
 const {app,get}=appFixture();
 Object.assign(app.state,{role:"teacher",mode:"demo",students:[{id:"s",name:"小明",teacher_id:"t"}],
 studentInvitations:[],studentLinks:[],lessons:[{id:"lesson-history",type:"lesson",student_id:"s",owner_id:"t",remarks:"理解進步"}],
 schedules:[],exceptions:[],requests:[],paymentBatches:[],paymentBatchItems:[]});
 app.setUser({id:"t",email:"teacher@demo.test"});
 get("#student-invite-student").value="s";get("#student-invite-email").value="pupil@demo.test";
 await app.sendStudentInvite({preventDefault(){}});
 assert.equal(app.state.studentInvitations.length,1);
 const id=app.state.studentInvitations[0].id;
 app.state.role="student";app.setUser({id:"p",email:"pupil@demo.test"});
 await app.acceptStudentInvite(id);
 assert.equal(app.state.studentLinks[0].user_id,"p");
 app.state.role="teacher";app.setUser({id:"t",email:"teacher@demo.test"});
 await app.revokeStudentInvite(id);
 assert.equal(app.state.studentInvitations.length,0);
 assert.equal(app.state.studentLinks.length,0);
 assert.equal(app.state.lessons[0].remarks,"理解進步");
});
test("Student-mode lessons come from the restricted RPC only, not teacher/parent arrays",async()=>{
 const {app}=appFixture();
 app.state.role="student";app.state.mode="live";
 app.setUser({id:"s-user",email:"s@example.test"});
 app.state.students=[{id:"another-student",name:"不應顯示",teacher_id:"t",hourly_rate:999}];
 app.state.lessons=[{id:"private",student_id:"another-student",type:"lesson",total_amount:9000}];
 app.setClient({rpc:async(name)=>{assert.equal(name,"student_portal_snapshot");return{error:null,data:{
 students:[{id:"mine",name:"我的課程",teacher_id:"t",subject:"英文"}],
 lessons:[{id:"own",student_id:"mine",owner_id:"t",type:"lesson",lesson_date:"2026-10-20",subject:"英文",remarks:"進度良好"}],
 schedules:[],exceptions:[]}}}});
 await app.refreshStudentPortal();
 assert.deepEqual(app.visibleStudents().map(s=>s.id),["mine"]);
 assert.deepEqual(app.visibleLessons().map(l=>l.id),["own"]);
 assert.equal(app.visibleLessons()[0].total_amount,undefined);
});
test("Student enrollment SQL enforces teacher invitation, linked user and revocation",()=>{
 const sql=read("../supabase/migrations/20261020062000_v32_student_portal_identity.sql");
 assert.ok(sql.includes("alter table public.student_links enable row level security"));
 assert.ok(sql.includes("i.id=public.student_links.invitation_id"));
 assert.ok(sql.includes("i.student_id=public.student_links.student_id"));
 assert.ok(sql.includes("i.email=lower((select auth.jwt())->>'email')"));
 assert.ok(sql.includes("references public.student_invitations(id) on delete cascade"));
 assert.ok(sql.includes("l.user_id=(select auth.uid())"));
 assert.ok(sql.includes("security definer"));
 assert.ok(sql.includes("revoke all on function public.student_portal_snapshot() from public,anon"));
 const rpc=sql.slice(sql.indexOf("create or replace function public.student_portal_snapshot()"));
 for(const sensitive of ["hourly_rate","total_amount","paid_amount","parent_note","guardian_id","payment_date"]){
  assert.ok(!rpc.includes("'"+sensitive+"'"),"Sensitive field leaked via student portal "+sensitive);
 }
 assert.ok(!sql.includes("create policy student_")||!sql.includes("on public.lesson_records for select to authenticated using(true)"));
});
