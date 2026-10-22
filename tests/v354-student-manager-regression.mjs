// V3.5.4: Student-first view, no accidental cross-teacher access or fee edits.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {expandSchedules} from "../v2/scheduling.js";
import {lessonAllocation} from "../v2/payment-ledger.js";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const source=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");
const migration=read("../supabase/migrations/20261022113000_v354_student_account_disconnect.sql");
const sqlFixture=read("./sql/v354_student_account_disconnect_rollback.sql");

function harness(){
 const elements=new Map();
 const querySelector=selector=>{
  if(!elements.has(selector)){
   const classes=new Set();
   elements.set(selector,{
    id:selector.startsWith("#")?selector.slice(1):"",
    innerHTML:"",textContent:"",value:"",hidden:false,open:false,
    style:{},dataset:{},
    classList:{
     add(v){classes.add(v)},remove(v){classes.delete(v)},
     toggle(v,force){if(force===undefined? !classes.has(v):force){classes.add(v);return true}classes.delete(v);return false},
     contains(v){return classes.has(v)}
    },
    reset(){this.value=""},setAttribute(){},showModal(){this.open=true},close(){this.open=false}
   });
  }
  return elements.get(selector);
 };
 const document={querySelector,querySelectorAll:selector=>selector===".modal"?
  [...elements.values()].filter(el=>el.id==="student-management-modal"||el.id==="account-modal"):[],
  body:{classList:{toggle(){}}},activeElement:null};
 const code=source.replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
 const api=new Function("document","localStorage","window","crypto","setTimeout","FormData",
  "expandSchedules","lessonAllocation","confirm",
  code+"\npersist=async(op)=>{await op();return true};render=()=>{};return {"+
    "state,teacherStudentAccountRows,teacherGuardianAccountRows,renderTeacherStudentList,"+
    "renderTeacherStudentManagement,openStudentManager,renderStudentManagerDetail,"+
    "saveManagedStudent,submitManagedStudentInvite,submitManagedGuardianInvite,"+
    "revokeManagedStudentAccount,removeStudentInvite,clearUserSessionState,"+
    "setUser(u){activeUser=u},setClient(c){client=c}};")(
   document,{getItem(){return null},setItem(){}},{},{randomUUID:()=>"test-id"},
   ()=>0,FormData,expandSchedules,lessonAllocation,()=>true);
 return {api,el:querySelector};
}

function setTeacherData(api){
 api.setUser({id:"teacher-a",email:"teacher@example.test"});
 api.state.role="teacher";
 api.state.mode="live";
 api.state.workspaces=[{id:"workspace-a",owner_id:"teacher-a",name:"測試家教"}];
 api.state.students=[
  {id:"s1",teacher_id:"teacher-a",name:"王小明",subject:"數學",hourly_rate:500},
  {id:"s2",teacher_id:"teacher-a",name:"陳小美",subject:"英文",hourly_rate:650},
  {id:"external",teacher_id:"teacher-b",name:"其他老師的學生",subject:"理化",hourly_rate:800}
 ];
 api.state.studentInvites=[
  {id:"student-invite-1",student_id:"s1",teacher_id:"teacher-a",email:"student@example.test"},
  {id:"student-invite-2",student_id:"s2",teacher_id:"teacher-a",email:"second@example.test"}
 ];
 api.state.studentLegacyInvites=[
  {id:"legacy-1",student_id:"s1",teacher_id:"teacher-a",email:"student@example.test"}
 ];
 api.state.studentLinks=[
  {id:"link-1",student_id:"s1",teacher_id:"teacher-a",invitation_id:"legacy-1",user_id:"student-user"},
  {id:"external-link",student_id:"external",teacher_id:"teacher-b",invitation_id:"external-legacy"}
 ];
 api.state.invites=[
  {id:"guardian-invite-1",student_id:"s1",teacher_id:"teacher-a",email:"parent1@example.test"},
  {id:"guardian-invite-2",student_id:"s1",teacher_id:"teacher-a",email:"parent2@example.test"},
  {id:"guardian-invite-3",student_id:"s2",teacher_id:"teacher-a",email:"parent3@example.test"}
 ];
 api.state.guardians=[{id:"g1",teacher_id:"teacher-a",student_id:"s1",
  invite_id:"guardian-invite-1",guardian_id:"parent-user"}];
 api.state.lessons=[];
}

test("the teacher's student list shows own students, rates and student/guardian status",()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.renderTeacherStudentManagement();
 const html=el("#teacher-student-list").innerHTML;
 for(const term of ["王小明","陳小美","NT$ 500","NT$ 650","學生帳號","家長帳號","等待學生接受","學生已連結","家長已連結"])
  assert.ok(html.includes(term),"missing "+term);
 assert.ok(!html.includes("其他老師的學生"));
 assert.ok(el("#student-grid").classList.contains("hidden"),"old teacher-only student cards must be hidden");
 assert.ok(el("#guardian-invite-card").classList.contains("hidden"),"old teacher invite list must be hidden");
 const summary=el("#teacher-student-summary").innerHTML;
 assert.ok(summary.includes("學生總數"));
 assert.ok(summary.includes("2</strong>"),"expected two owned students");
});

test("search, connected filter and pending filter narrow the list without losing context",()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.state.studentSearch="小明";
 api.renderTeacherStudentList();
 assert.match(el("#teacher-student-list").innerHTML,/王小明/);
 assert.doesNotMatch(el("#teacher-student-list").innerHTML,/陳小美/);
 api.state.studentSearch="";
 api.state.studentAccountFilter="linked";
 api.renderTeacherStudentList();
 assert.match(el("#teacher-student-list").innerHTML,/王小明/);
 assert.doesNotMatch(el("#teacher-student-list").innerHTML,/陳小美/);
 api.state.studentAccountFilter="pending";
 api.renderTeacherStudentList();
 assert.match(el("#teacher-student-list").innerHTML,/陳小美/);
});

test("clicking a student opens one detail with linked student, multiple parents and their statuses",()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.openStudentManager("s1");
 assert.equal(el("#student-management-modal").open,true);
 assert.match(el("#student-management-heading").textContent,/王小明/);
 assert.equal(el("#managed-student-name").value,"王小明");
 assert.equal(el("#managed-student-rate").value,"500");
 const studentHtml=el("#managed-student-accounts").innerHTML;
 assert.match(studentHtml,/student@example.test/);
 assert.match(studentHtml,/已連結/);
 assert.match(studentHtml,/revoke-managed-student/);
 const parentHtml=el("#managed-guardian-accounts").innerHTML;
 assert.match(parentHtml,/parent1@example.test/);
 assert.match(parentHtml,/parent2@example.test/);
 assert.match(parentHtml,/解除連結/);
 assert.match(parentHtml,/等待接受/);
 assert.match(parentHtml,/修改 Email/);
 assert.doesNotMatch(parentHtml,/parent3@example.test/);
 api.openStudentManager("external");
 assert.match(el("#student-management-heading").textContent,/王小明/,"cannot open another teacher's student");
});

test("account link status comes from the real legacy-invitation FK, not mere matching student id",()=>{
 const {api}=harness();
 setTeacherData(api);
 api.state.studentLegacyInvites.push({
  id:"legacy-unclaimed",student_id:"s1",teacher_id:"teacher-a",email:"other@example.test"
 });
 const rows=api.teacherStudentAccountRows("s1");
 assert.equal(rows.find(r=>r.email==="student@example.test").connected,true);
 assert.equal(rows.find(r=>r.email==="other@example.test").connected,false);
 assert.ok(!rows.some(r=>r.email==="second@example.test"));
});

test("editing student defaults is teacher-owned and does not mutate historic lessons",async()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.openStudentManager("s1");
 let updated=null,where=[];
 api.setClient({from(table){
  assert.equal(table,"students");
  return {
   update(payload){updated=payload;return this},
   eq(key,val){where.push([key,val]);return this},
   select(){return this},
   async single(){return {data:{id:"s1"},error:null}}
  };
 }});
 api.state.lessons=[{id:"old-lesson",student_id:"s1",hourly_rate:500,total_amount:1000,status:"老師已收到"}];
 el("#managed-student-name").value="王同學";
 el("#managed-student-subject").value="物理";
 el("#managed-student-rate").value="750";
 await api.saveManagedStudent({preventDefault(){}});
 assert.deepEqual(updated,{name:"王同學",subject:"物理",hourly_rate:750});
 assert.deepEqual(where,[["id","s1"],["teacher_id","teacher-a"]]);
 assert.equal(api.state.lessons[0].total_amount,1000);
 assert.equal(api.state.lessons[0].hourly_rate,500);
});

test("inviting either account uses the selected student and the current teacher, never an arbitrary id",async()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.openStudentManager("s1");
 const inserted=[];
 api.setClient({from(table){return {async insert(row){inserted.push({table,...row});return {error:null}}}}});
 el("#managed-student-email").value="OTHERSTUDENT@Example.TEST";
 el("#managed-guardian-email").value="OtherParent@Example.TEST";
 await api.submitManagedStudentInvite({preventDefault(){}});
 await api.submitManagedGuardianInvite({preventDefault(){}});
 assert.deepEqual(inserted,[
  {table:"student_invites",teacher_id:"teacher-a",student_id:"s1",email:"otherstudent@example.test"},
  {table:"guardian_invites",teacher_id:"teacher-a",student_id:"s1",email:"otherparent@example.test"}
 ]);
});

test("student disconnect routes to atomic authorized RPC, never only deletes the invitation",async()=>{
 const {api}=harness();
 setTeacherData(api);
 const calls=[];
 api.setClient({async rpc(name,args){calls.push({name,args});return {error:null}}});
 await api.revokeManagedStudentAccount("s1","student@example.test");
 assert.deepEqual(calls,[{name:"revoke_student_account_connection",args:{
  p_student_id:"s1",p_email:"student@example.test"
 }}]);
});

test("signout clears the selected student and closes their private management dialog",()=>{
 const {api,el}=harness();
 setTeacherData(api);
 api.openStudentManager("s1");
 api.state.studentSearch="王";
 api.state.studentAccountFilter="linked";
 api.clearUserSessionState();
 assert.equal(api.state.managedStudentId,null);
 assert.equal(api.state.studentSearch,"");
 assert.equal(api.state.studentAccountFilter,"all");
 assert.equal(api.state.studentLegacyInvites.length,0);
 assert.equal(el("#student-management-modal").open,false);
 assert.equal(el("#managed-student-accounts").innerHTML,"");
});

test("auth-sensitive UI and RLS-safe RPC are present without over-granting anon",()=>{
 for(const id of ["teacher-student-manager","teacher-student-search","teacher-student-filter",
  "student-management-modal","student-management-basics-form",
  "managed-student-invite-form","managed-guardian-invite-form"]){
  assert.ok(html.includes('id="'+id+'"'),"missing "+id);
 }
 assert.match(css,/\.student-manager-row/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(migration,/security invoker/i);
 assert.match(migration,/delete from public\.student_invitations/);
 assert.match(migration,/delete from public\.student_invites/);
 assert.match(migration,/revoke all on function public\.revoke_student_account_connection\(uuid,text\) from public, anon;/i);
 assert.match(sqlFixture,/FAILED: unrelated teacher revoked another student account/);
 assert.match(sqlFixture,/FAILED: account disconnection modified historical lesson/);
});
