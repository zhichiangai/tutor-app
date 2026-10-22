// V3.5.8 three-role calendar, scoped student portal, and recent-change disclosure.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {expandSchedules} from "../v2/scheduling.js";
import {lessonAllocation} from "../v2/payment-ledger.js";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const code=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");

function harness(){
 const nodes=new Map();
 function el(key){
  if(!nodes.has(key)){
   const classes=new Set(),attrs=new Map();
   nodes.set(key,{textContent:"",innerHTML:"",hidden:false,disabled:false,value:"",
    style:{},dataset:{},
    classList:{
     add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),
     toggle(k,force){const on=force===undefined?!classes.has(k):Boolean(force);
      if(on)classes.add(k);else classes.delete(k);return on;}
    },
    setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
    reset(){},showModal(){this.open=true},close(){this.open=false}
   });
  }
  return nodes.get(key);
 }
 const modeButtons=["month","list"].map(x=>{const node=el("#mode-"+x);node.dataset.studentCalendarMode=x;return node});
 const document={querySelector:el,querySelectorAll:q=>{
  if(q==="[data-student-calendar-mode]")return modeButtons;
  return [];
 },body:{classList:{toggle(){}}},activeElement:null};
 const src=code.replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
 const overrides=[
  "renderStudentPortal=()=>{};renderSharedPlanner=()=>{};",
  "renderStudentToday=()=>{};renderRoleSettings=()=>{};renderWorkspaceUI=()=>{};",
  "return {state,renderStudentCalendar,renderRecentChanges,",
  "moveStudentMonth,selectStudentDay,clearUserSessionState,",
  "setUser(u){activeUser=u},setPhase(p){authPhase=p}};"
 ].join("\n");
 const app=new Function("document","localStorage","window","crypto","setTimeout",
  "FormData","expandSchedules","lessonAllocation",src+"\n"+overrides)(
  document,{getItem(){return null},setItem(){}},{},{randomUUID(){return "qa"}},()=>0,
  FormData,expandSchedules,lessonAllocation);
 return {app,el};
}
function linkedStudent(app){
 app.setUser({id:"test-user",email:"student@example.test"});
 app.setPhase("ready");app.state.mode="live";app.state.role="student";
 app.state.month=new Date(2026,9,1);app.state.selected="2026-10-23";
 app.state.studentPortal={
  students:[{id:"qa-linked",name:"QA 同學",subject:"數學"}],
  lessons:[
   {id:"a",student_id:"qa-linked",lesson_date:"2026-10-23",type:"planned",subject:"數學",
    start_time:"17:00",end_time:"19:00",hourly_rate:987654,total_amount:7654321},
   {id:"b",student_id:"other-student",lesson_date:"2026-10-23",type:"planned",
    subject:"機密課程",start_time:"10:00",end_time:"11:00"}
  ],schedules:[],exceptions:[]
 };
}
test("student monthly calendar is the first section; each role has a last-position history",()=>{
 const student=html.slice(html.indexOf('id="student-calendar-panel"'),html.indexOf('id="student-learning-panel"'));
 const parent=html.slice(html.indexOf('id="view-calendar"'),html.indexOf('id="view-billing"'));
 for(const id of ["student-calendar-grid","student-day-lessons","shared-student-card","student-recent-changes"])
  assert.ok(student.includes('id="'+id+'"'),id);
 const orderStudent=["student-calendar-grid","student-day-lessons","shared-student-card","student-recent-changes"];
 assert.deepEqual(orderStudent.map(id=>student.indexOf('id="'+id+'"')).slice().sort((a,b)=>a-b),
  orderStudent.map(id=>student.indexOf('id="'+id+'"')));
 assert.ok(parent.indexOf('id="calendar-month-view"')<parent.indexOf('id="agenda-list"'));
 assert.ok(parent.indexOf('id="agenda-list"')<parent.indexOf('id="shared-parent-card"'));
 assert.ok(parent.indexOf('id="shared-parent-card"')<parent.indexOf('id="calendar-recent-changes"'));
 assert.match(html,/V3\.5\.9 · Made with care/);
 assert.match(css,/\.student-calendar-cell/);
 assert.match(css,/\.recent-changes-toggle/);
});
test("student calendar shows authorized dates and hides rates, payment and other students",()=>{
 const {app,el}=harness();
 linkedStudent(app);app.renderStudentCalendar();
 const grid=el("#student-calendar-grid").innerHTML;
 const day=el("#student-day-lessons").innerHTML;
 const month=el("#student-calendar-list-view").innerHTML;
 assert.match(grid,/數學/);
 assert.match(day,/17:00/);
 assert.match(month,/2026-10-23/);
 for(const privateValue of ["987654","7654321","機密課程","other-student","hourly_rate","total_amount"]){
  assert.ok(![grid,day,month].some(text=>text.includes(privateValue)),privateValue);
 }
 assert.match(day,/<details/);
 assert.equal(el("#student-calendar-month").textContent,"2026 年 10 月");
});
test("student date selection and month/list stay on the student-scoped calendar",()=>{
 const {app,el}=harness();
 linkedStudent(app);
 app.selectStudentDay("2026-10-23");
 assert.match(el("#student-selected-date-title").textContent,/10月23日/);
 app.moveStudentMonth(-1);
 assert.equal(app.state.selected,"2026-09-01");
 assert.equal(el("#student-calendar-month").textContent,"2026 年 9 月");
 app.state.studentCalendarMode="list";app.renderStudentCalendar();
 assert.equal(el("#student-calendar-list-view").classList.contains("hidden"),false);
 assert.equal(el("#student-calendar-month-view").classList.contains("hidden"),true);
 app.selectStudentDay("2026-10-23");
 assert.equal(el("#student-calendar-month").textContent,"2026 年 10 月");
});
test("recent changes default closed and preserve open state after month navigation",()=>{
 const {app,el}=harness();
 linkedStudent(app);
 app.state.sharedCourseHistory={"qa-linked":[
  {summary:"課程改期",created_at:"2026-10-23T09:30:00"}
 ]};
 app.renderRecentChanges();
 assert.match(el("#student-recent-changes").innerHTML,/aria-expanded="false"/);
 assert.match(el("#student-recent-changes").innerHTML,/ hidden>/);
 app.state.recentChangesOpen=true;
 app.renderRecentChanges();
 assert.match(el("#student-recent-changes").innerHTML,/aria-expanded="true"/);
 assert.doesNotMatch(el("#student-recent-changes").innerHTML,/ hidden>/);
 app.moveStudentMonth(-1);
 app.renderRecentChanges();
 assert.match(el("#student-recent-changes").innerHTML,/收合/);
 assert.match(code,/data-recent-changes-toggle/);
});
test("teacher and parent history scopes use their authorized students",()=>{
 const {app,el}=harness();
 app.setUser({id:"teacher-id",email:"teacher@example.test"});app.state.mode="live";
 app.state.students=[
  {id:"my-student",teacher_id:"teacher-id",name:"我的學生"},
  {id:"other-student",teacher_id:"someone-else",name:"他人學生"}
 ];
 app.state.sharedCourseHistory={
  "my-student":[{summary:"允許的變更",created_at:"2026-10-23T08:00:00"}],
  "other-student":[{summary:"不應顯示的變更",created_at:"2026-10-23T09:00:00"}]
 };
 app.state.role="teacher";app.renderRecentChanges();
 assert.match(el("#calendar-recent-changes").innerHTML,/允許的變更/);
 assert.doesNotMatch(el("#calendar-recent-changes").innerHTML,/不應顯示的變更/);
 app.state.role="parent";app.state.guardians=[{guardian_id:"teacher-id",student_id:"my-student",teacher_id:"teacher-id"}];
 app.renderRecentChanges();
 assert.match(el("#calendar-recent-changes").innerHTML,/允許的變更/);
 assert.doesNotMatch(el("#calendar-recent-changes").innerHTML,/不應顯示的變更/);
});
test("logout erases recent changes disclosure and authorized portal data",()=>{
 const {app}=harness();
 linkedStudent(app);app.state.recentChangesOpen=true;
 app.state.sharedCourseHistory={"qa-linked":[{summary:"private history"}]};
 app.clearUserSessionState();
 assert.equal(app.state.recentChangesOpen,false);
 assert.deepEqual(app.state.sharedCourseHistory,{});
 assert.deepEqual(app.state.studentPortal.students,[]);
});
