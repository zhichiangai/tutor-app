// Run: node --test tests/v31-human-ux-regression.mjs
// All fixtures are in memory; no network calls or production data writes.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const parseModule=(path,names)=>new Function(read(path).replace(/^export /gm,"")+
 "\nreturn {"+names.join(",")+"}")();
const modules={
 ...parseModule("../v2/scheduling.js",["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...parseModule("../v2/payment-ledger.js",["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...parseModule("../v2/calendar-view.js",["monthAgendaMarkup","monthSummary"]),
 ...parseModule("../v2/lesson-actual.js",["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const appSource=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
function createApp(){
 const nodes=new Map(),values=new Map();
 const node=id=>({
  id,style:{},dataset:{},value:"",textContent:"",innerHTML:"",checked:false,disabled:false,open:false,
  classList:{s:new Set(),toggle(k,v){if(v===undefined)v=!this.s.has(k);v?this.s.add(k):this.s.delete(k);return v},
   add(k){this.s.add(k)},remove(k){this.s.delete(k)},contains(k){return this.s.has(k)}},
  showModal(){this.open=true},close(){this.open=false},setAttribute(){},addEventListener(){}
 });
 const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
 const document={querySelector:get,querySelectorAll:()=>[],addEventListener(){},activeElement:null};
 const localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const app=new Function("document","localStorage","crypto","confirm","console","setTimeout","FormData","window",...Object.keys(modules),
  appSource+"\nrender=()=>{};return {state,visibleLessons,renderStudentBilling,renderParentLearning,openCancel,submitCancel,submitInviteEdit,revokeInvite,setRole,"+
  "setUser(v){activeUser=v},setClient(v){client=v}}")(
  document,localStorage,{randomUUID:()=> "fixture-"+Math.random()},()=>true,console,()=>0,FormData,{},...Object.values(modules));
 return {app,get};
}
const rule=()=>({id:"rule-a",teacher_id:"teacher-a",student_id:"student-a",subject:"數學",
 starts_on:"2026-10-01",weekdays:[4],every_weeks:1,start_time:"18:00",end_time:"19:00",hourly_rate:500});
function fixture(){
 const {app,get}=createApp();
 Object.assign(app.state,{mode:"demo",role:"teacher",month:new Date(2026,9,1),
  students:[{id:"student-a",teacher_id:"teacher-a",name:"學生甲",subject:"數學"}],
  lessons:[],schedules:[rule()],exceptions:[],invites:[],guardians:[],paymentBatches:[],paymentBatchItems:[],requests:[]});
 app.setUser({id:"teacher-a",email:"teacher@example.test"});
 return {app,get};
}

test("Header visibly identifies the teacher/guardian role on desktop and mobile",()=>{
 const html=read("../v2/index.html");
 for(const id of ["role-indicator","role-indicator-text","role-menu","parent-learning-home",
 "billing-student-summary","parent-learning","cancel-modal","invite-edit-modal"])
  assert.ok(html.includes('id="'+id+'"'),"Missing visible element "+id);
 const css=read("../v2/style.css");
 assert.ok(css.includes("@media(max-width:650px)")&&css.includes(".role-indicator"));
});

test("Only the future occurrences are suppressed; earlier recurrences remain",()=>{
 const r={...rule(),cancelled_from:"2026-10-22"};
 assert.equal(modules.matchesRecurrence(r,"2026-10-15"),true);
 assert.equal(modules.matchesRecurrence(r,"2026-10-22"),false);
 assert.equal(modules.matchesRecurrence(r,"2026-10-29"),false);
 const projected=modules.expandSchedules({schedules:[r],lessons:[],exceptions:[],
  allowedStudents:["student-a"],month:new Date(2026,9,1),today:"2026-10-20"});
 assert.ok(projected.some(l=>l.lesson_date==="2026-10-15"));
 assert.ok(!projected.some(l=>l.lesson_date==="2026-10-29"));
});

test("Cancel one projected lesson without canceling other weekly occurrences",async()=>{
 const {app,get}=fixture();const l=app.visibleLessons().find(x=>x.lesson_date==="2026-10-22");
 assert.ok(l?.virtual_occurrence);
 app.openCancel(l);get('input[name="cancel-scope"]:checked').value="one";
 await app.submitCancel({preventDefault(){}});
 assert.equal(app.state.exceptions.length,1);
 assert.equal(app.state.exceptions[0].action,"teacher_leave");
 assert.ok(app.visibleLessons().some(x=>x.lesson_date==="2026-10-29"&&x.type==="planned"));
});

test("Cancel all future occurrences while retaining previous sessions",async()=>{
 const {app,get}=fixture();const l=app.visibleLessons().find(x=>x.lesson_date==="2026-10-22");
 app.openCancel(l);get('input[name="cancel-scope"]:checked').value="future";
 await app.submitCancel({preventDefault(){}});
 assert.equal(app.state.schedules[0].cancelled_from,"2026-10-22");
 assert.ok(app.visibleLessons().some(x=>x.lesson_date==="2026-10-15"));
 assert.ok(!app.visibleLessons().some(x=>x.lesson_date==="2026-10-29"));
});

test("Standalone unbilled mistaken lesson can be deleted without affecting others",async()=>{
 const {app,get}=fixture();
 app.state.schedules=[];app.state.lessons=[
 {id:"mistake",type:"planned",status:"未付款",owner_id:"teacher-a",student_id:"student-a",lesson_date:"2026-10-22"},
 {id:"history",type:"lesson",status:"老師已收到",owner_id:"teacher-a",student_id:"student-a",lesson_date:"2026-10-15",total_amount:500}
 ];
 app.openCancel(app.state.lessons[0]);get('input[name="cancel-scope"]:checked').value="delete";
 await app.submitCancel({preventDefault(){}});
 assert.deepEqual(app.state.lessons.map(l=>l.id),["history"]);
});

test("Teacher per-student billing splits confirmed, pending and unpaid amounts",()=>{
 const {app,get}=fixture();
 const lessons=[
 {id:"a",student_id:"student-a",subject:"數學",lesson_date:"2026-10-08",type:"lesson",total_amount:500},
 {id:"b",student_id:"student-a",subject:"物理",lesson_date:"2026-10-15",type:"lesson",total_amount:800}
 ];
 app.state.paymentBatches=[{id:"batch",status:"confirmed"}];
 app.state.paymentBatchItems=[{batch_id:"batch",lesson_id:"a",allocated_amount:300}];
 app.renderStudentBilling(lessons);
 const markup=get("#billing-student-summary").innerHTML;
 for(const token of ["學生甲","數學","物理","NT$ 1,300","NT$ 300","NT$ 1,000"])
  assert.ok(markup.includes(token),"Missing billing summary "+token);
});

test("Guardian revocation removes both invitation and connection, but preserves lessons",async()=>{
 const {app}=fixture();
 app.state.invites=[{id:"invite-a",student_id:"student-a",teacher_id:"teacher-a",email:"p@example.test"}];
 app.state.guardians=[{id:"link-a",invite_id:"invite-a",student_id:"student-a",teacher_id:"teacher-a",guardian_id:"parent-a"}];
 app.state.lessons=[{id:"paid-history",owner_id:"teacher-a",student_id:"student-a",type:"lesson",status:"老師已收到",total_amount:500}];
 await app.revokeInvite("invite-a");
 assert.equal(app.state.invites.length,0);
 assert.equal(app.state.guardians.length,0);
 assert.equal(app.state.lessons.length,1);
});

test("Parent can read feedback only while authorized for that student",()=>{
 const {app,get}=fixture();
 app.state.mode="live";app.state.role="parent";app.setUser({id:"parent-a"});
 app.state.lessons=[{id:"lesson-a",owner_id:"teacher-a",student_id:"student-a",type:"lesson",
  lesson_date:"2026-10-12",subject:"數學",hours:1,remarks:"理解程度提升",focus_rating:4,attitude_rating:5}];
 app.state.guardians=[{student_id:"student-a",guardian_id:"parent-a",teacher_id:"teacher-a"}];
 app.renderParentLearning();
 assert.ok(get("#parent-learning").innerHTML.includes("理解程度提升"));
 assert.ok(get("#parent-learning").innerHTML.includes("4／5"));
 app.state.guardians=[];app.renderParentLearning();
 assert.ok(!get("#parent-learning").innerHTML.includes("理解程度提升"));
});

test("Migration allows pending email edits but blocks owner changes and retains paid history",()=>{
 const sql=read("../supabase/migrations/20261020051000_v31_cancel_recurrence_and_invite_edit.sql");
 assert.ok(sql.includes("grant update(email) on public.guardian_invites"));
 assert.ok(sql.includes("not exists(select 1 from public.student_guardians"));
 assert.ok(sql.includes("security invoker"));
 assert.ok(sql.includes("l.type='planned'"));
 assert.ok(!sql.includes("delete from public.lesson_records"));
});
