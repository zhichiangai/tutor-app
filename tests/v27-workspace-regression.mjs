// Run from repo root: node --test tests/v27-workspace-regression.mjs
// No production writes; this suite runs with mocked browser state.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(new URL(file,import.meta.url),"utf8");
const parseModule = (path,names) => new Function(read(path).replace(/^export (const|function)/gm,"$1")+
 "\nreturn {"+names.join(",")+"};")();
const modules={
 ...parseModule("../v2/scheduling.js",["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...parseModule("../v2/payment-ledger.js",["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...parseModule("../v2/calendar-view.js",["monthAgendaMarkup","monthSummary"]),
 ...parseModule("../v2/lesson-actual.js",["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const appSource=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
function createApp(){
 const elements=new Map();
 const element=name=>({
  name,style:{},dataset:{},value:"",textContent:"",innerHTML:"",disabled:false,open:false,
  classList:{items:new Set(),toggle(name,enabled){if(enabled)this.items.add(name);else this.items.delete(name)},
   contains(name){return this.items.has(name)},add(name){this.items.add(name)},remove(name){this.items.delete(name)}},
  addEventListener(){},setAttribute(){},appendChild(){},showModal(){this.open=true},close(){this.open=false}
 });
 const document={
  querySelector(selector){if(!elements.has(selector))elements.set(selector,element(selector));return elements.get(selector)},
  querySelectorAll(){return []},createElement:element,addEventListener(){}
 };
 const values=new Map(),localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const app=new Function("document","localStorage","crypto","confirm","console","window",...Object.keys(modules),
 appSource+"\nreturn {state,loadDemo,visibleStudents,visiblePaymentBatches,renderWorkspaceUI,ensureMyProfile,requireTeacherWorkspace,"+
 "setActiveUser(v){activeUser=v},setClient(v){client=v}}")(
 document,localStorage,{randomUUID:()=> "fixture-id"},()=>true,console,{},...Object.values(modules));
 return {app,element:id=>document.querySelector("#"+id)};
}

test("Archived preview fixtures can still load explicitly in tests without tenant setup",()=>{
 const {app}=createApp();app.state.mode="demo";app.loadDemo();assert.equal(app.visibleStudents().length,3);
});

test("New teacher sees setup; existing owner sees their own students",()=>{
 const {app,element}=createApp();
 app.state.mode="live";app.state.role="teacher";app.setActiveUser({id:"a",email:"a@example.test"});
 app.state.students=[{id:"sa",teacher_id:"a"},{id:"sb",teacher_id:"b"}];
 app.state.guardians=[];app.state.workspaces=[];
 app.renderWorkspaceUI();
 assert.equal(element("workspace-setup").classList.contains("hidden"),false);
 assert.equal(app.requireTeacherWorkspace(),false);
 assert.deepEqual(app.visibleStudents().map(s=>s.id),["sa"]);
 app.state.workspaces=[{id:"wa",owner_id:"a",name:"數學教室"}];
 app.renderWorkspaceUI();
 assert.equal(element("workspace-setup").classList.contains("hidden"),true);
 assert.equal(app.requireTeacherWorkspace(),true);
});

test("Guardian may filter courses and payments by teacher while using one login",()=>{
 const {app,element}=createApp();
 app.state.mode="live";app.state.role="parent";
 app.setActiveUser({id:"parent",email:"parent@example.test"});
 app.state.students=[{id:"sa",teacher_id:"a"},{id:"sb",teacher_id:"b"}];
 app.state.workspaces=[{id:"wa",owner_id:"a",name:"數學教室"},{id:"wb",owner_id:"b",name:"英文教室"}];
 app.state.guardians=[
 {student_id:"sa",teacher_id:"a",guardian_id:"parent"},
 {student_id:"sb",teacher_id:"b",guardian_id:"parent"}
 ];
 app.state.paymentBatches=[
 {id:"pa",teacher_id:"a",student_id:"sa",parent_id:"parent",created_at:"2026-10-20"},
 {id:"pb",teacher_id:"b",student_id:"sb",parent_id:"parent",created_at:"2026-10-19"}
 ];
 app.renderWorkspaceUI();
 assert.equal(element("parent-teacher-bar").classList.contains("hidden"),false);
 assert.equal(app.visibleStudents().length,2);
 app.state.parentTeacherFilter="b";
 app.renderWorkspaceUI();
 assert.deepEqual(app.visibleStudents().map(s=>s.id),["sb"]);
 assert.deepEqual(app.visiblePaymentBatches().map(x=>x.id),["pb"]);
});

test("Google account profile uses Auth user ID, never user-supplied role",async()=>{
 const {app}=createApp();const operations=[];
 app.setActiveUser({id:"auth-user",user_metadata:{full_name:"測試老師"}});
 app.setClient({from(table){assert.equal(table,"profiles");return {
  select(){return this},eq(){return this},
  async maybeSingle(){return {data:null,error:null}},
  async insert(row){operations.push(row);return {error:null}}
 } }});
 await app.ensureMyProfile();
 assert.deepEqual(operations,[{id:"auth-user",display_name:"測試老師"}]);
 assert.equal(Object.hasOwn(operations[0],"role"),false);
});

test("Onboarding markup exists and does not modify V1",()=>{
 const html=read("../v2/index.html");
 for(const id of ["workspace-setup","workspace-account","workspace-create","workspace-rename",
 "parent-teacher-bar","parent-teacher-select"])
 assert.ok(html.includes('id="'+id+'"'),id);
 const v1=read("../index.html");
 assert.ok(v1.includes("frontend/index.html"));
});
