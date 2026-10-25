// V3.5.5: student role navigation, automatic landing and account isolation.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {expandSchedules} from "../v2/scheduling.js";
import {lessonAllocation} from "../v2/payment-ledger.js";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const code=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");
const standard=["home","calendar","billing","students","settings"];
const student=["student-today","student-calendar","student-learning","settings"];
const pages=["view-home","view-calendar","view-billing","view-students","view-student","view-settings"];

function harness(){
 const nodes=new Map();
 function get(selector){
  if(!nodes.has(selector)){
   const classes=new Set();
   const attrs=new Map();
   nodes.set(selector,{
    innerHTML:"",textContent:"",value:"",disabled:false,open:false,hidden:false,style:{},dataset:{},
    classList:{
     contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k),
     toggle(k,force){const value=force===undefined?!classes.has(k):Boolean(force);
      value?classes.add(k):classes.delete(k);return value;}
    },
    setAttribute(k,v){attrs.set(k,v)},getAttribute(k){return attrs.get(k)},
    reset(){},showModal(){this.open=true},close(){this.open=false}
   });
  }
  return nodes.get(selector);
 }
 const pageNodes=pages.map(id=>{const el=get("#"+id);el.id=id;return el});
 const navItems=[
  ...standard.map((value,i)=>{const el=get("#standard-"+i);el.dataset.view=value;el.navRole="standard";return el}),
  ...student.map((value,i)=>{const el=get("#student-"+i);el.dataset.view=value;el.navRole="student";return el})
 ];
 const navMobile=[
  ...standard.map((value,i)=>{const el=get("#m-standard-"+i);el.dataset.view=value;el.navRole="standard";return el}),
  ...student.map((value,i)=>{const el=get("#m-student-"+i);el.dataset.view=value;el.navRole="student";return el})
 ];
 const document={
  querySelector:get,
  querySelectorAll:selector=>{
   if(selector===".page-view")return pageNodes;
   if(selector===".side-nav [data-view], .mobile-nav [data-view]")return [...navItems,...navMobile];
   return [];
  },activeElement:null,body:{classList:{toggle(){}}}
 };
 const storage=new Map();
 const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,String(val))};
 const src=code.replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
 const overrides=[
  "renderRoleSettings=()=>{};renderWorkspaceUI=()=>{};",
  "renderNext=()=>{};renderRecent=()=>{};renderMiniCalendar=()=>{};renderFullCalendar=()=>{};",
  "renderBilling=()=>{};renderStudents=()=>{};refreshDaySheet=()=>{};renderSharedPlanner=()=>{};",
  "renderStudentPortal=()=>{};renderStudentCalendar=()=>{};renderRecentChanges=()=>{};renderHomeFocus=()=>{};toast=()=>{};",
  "return {state,render,setView,setRole,normalizeView,syncCurrentView,renderStudentToday,clearUserSessionState,",
  "setUser(u){activeUser=u},setAuthPhase(p){authPhase=p}};"
 ].join("\n");
 const app=new Function("document","localStorage","window","crypto","setTimeout",
  "FormData","expandSchedules","lessonAllocation",
  src+"\n"+overrides)(document,localStorage,{}, {randomUUID:()=>"test"},()=>0,FormData,expandSchedules,lessonAllocation);
 return {app,get,nav:[...navItems,...navMobile],pages:pageNodes};
}
function init(app,role){
 app.setUser({id:"qa-"+role,email:role+"@example.test"});
 app.setAuthPhase("ready");
 app.state.mode="live";app.state.role=role;
 app.state.enabledRoles=["teacher","parent","student"];
 app.state.students=[];app.state.lessons=[];
 app.state.studentPortal={students:[],lessons:[],schedules:[],exceptions:[]};
}
test("HTML has four student tabs in desktop and mobile, without student billing",()=>{
 for(const v of ["student-today","student-calendar","student-learning"]){
  assert.ok(html.includes('data-view="'+v+'"'));
  assert.equal([...html.matchAll(new RegExp('data-view="'+v+'"','g'))].length,2,v);
 }
 assert.ok(html.includes('class="nav-student" data-view="settings"'));
 for(const id of ["student-today-panel","student-calendar-panel","student-learning-panel","student-today-content"])
  assert.ok(html.includes('id="'+id+'"'));
 assert.match(css,/\.nav-student\{display:none!important\}/);
 assert.match(css,/\.student-mode \.nav-standard\{display:none!important\}/);
 assert.match(css,/\.student-mode \.mobile-nav \.nav-student\{display:flex!important\}/);
 assert.doesNotMatch(css,/\.student-mode \.side-nav,\.student-mode \.mobile-nav\{display:none!important\}/);
 assert.ok(html.includes("V4 Beta · Made with care."));
});
test("student login immediately shows Today and selected tab",()=>{
 const {app,get,nav}=harness();
 init(app,"student");app.state.view="student-today";app.render();
 assert.equal(app.state.view,"student-today");
 assert.equal(get("#view-student").classList.contains("hidden"),false);
 assert.equal(get("#view-home").classList.contains("hidden"),true);
 assert.equal(get("#student-today-panel").classList.contains("hidden"),false);
 assert.equal(get("#student-calendar-panel").classList.contains("hidden"),true);
 assert.equal(get("#student-learning-panel").classList.contains("hidden"),true);
 assert.equal(get("#breadcrumb-name").textContent,"今天");
 assert.ok(nav.filter(x=>x.dataset.view==="student-today"&&x.navRole==="student")
  .every(x=>x.classList.contains("active")&&x.getAttribute("aria-current")==="page"));
});
test("student schedule, learning, and settings switch panels and active tabs",()=>{
 const {app,get,nav}=harness();init(app,"student");
 for(const [view,panel,title] of [
  ["student-calendar","student-calendar-panel","我的課表"],
  ["student-learning","student-learning-panel","學習紀錄"],
  ["settings",null,"設定"],["student-today","student-today-panel","今天"]]){
  app.setView(view);
  assert.equal(app.state.view,view);
  assert.equal(get("#breadcrumb-name").textContent,title);
  assert.equal(get("#view-settings").classList.contains("hidden"),view!=="settings");
  assert.equal(get("#view-student").classList.contains("hidden"),view==="settings");
  for(const section of ["student-today-panel","student-calendar-panel","student-learning-panel"])
   assert.equal(get("#"+section).classList.contains("hidden"),section!==panel);
  assert.ok(nav.filter(n=>n.navRole==="student"&&n.dataset.view===view).every(n=>n.classList.contains("active")));
 }
});
test("student cannot navigate into teacher billing, but previous learning route works",()=>{
 const {app,get}=harness();init(app,"student");
 app.setView("student");assert.equal(app.state.view,"student-learning");
 for(const v of ["billing","students","calendar","home"]){
  app.setView(v);assert.equal(app.state.view,"student-today");
  assert.equal(get("#view-billing").classList.contains("hidden"),true);
  assert.equal(get("#view-students").classList.contains("hidden"),true);
 }
});
test("teacher and parent login automatically select original five-tab Today",()=>{
 for(const role of ["teacher","parent"]){
  const {app,get,nav}=harness();init(app,role);app.state.view="home";app.render();
  assert.equal(get("#view-home").classList.contains("hidden"),false);
  assert.equal(get("#breadcrumb-name").textContent,"今天");
  assert.ok(nav.filter(n=>n.navRole==="standard"&&n.dataset.view==="home")
   .every(n=>n.classList.contains("active")&&n.getAttribute("aria-current")==="page"));
  assert.ok(nav.filter(n=>n.navRole==="student").every(n=>!n.classList.contains("active")));
 }
});
test("role switching resets landing to the selected role",()=>{
 const {app,get}=harness();init(app,"teacher");app.render();
 app.setRole("student");
 assert.equal(app.state.view,"student-today");
 assert.equal(get("#view-billing").classList.contains("hidden"),true);
 app.setRole("parent");assert.equal(app.state.view,"home");
 assert.equal(get("#view-home").classList.contains("hidden"),false);
});
test("student Today uses linked lessons only and never displays financial data",()=>{
 const {app,get}=harness();init(app,"student");
 const d=new Date(Date.now()+86400000);
 const date=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
 app.state.studentPortal={
  students:[{id:"mine",name:"測試同學",subject:"英文"}],
  lessons:[
   {id:"next",student_id:"mine",subject:"英文",lesson_date:date,start_time:"17:00",end_time:"18:00",type:"planned",hourly_rate:987654,total_amount:987654},
   {id:"done",student_id:"mine",subject:"數學",lesson_date:"2026-10-20",start_time:"18:00",type:"lesson",lesson_content:"代數練習",focus_rating:4,mood_rating:5,remarks:"老師回饋",hourly_rate:123456,total_amount:123456},
   {id:"other",student_id:"OTHER",subject:"秘密課程",lesson_date:date,type:"planned",hourly_rate:999999,total_amount:999999}
  ],schedules:[]
 };
 app.renderStudentToday();
 const out=get("#student-today-content").innerHTML;
 for(const term of ["測試同學","英文","代數練習","4／5","5／5","查看我的課表","查看學習紀錄"])
  assert.ok(out.includes(term),term);
 for(const forbidden of ["NT$","987654","123456","999999","秘密課程","付款","收款"])
  assert.ok(!out.includes(forbidden),forbidden);
});
test("student without linked courses sees useful guidance",()=>{
 const {app,get}=harness();init(app,"student");app.renderStudentToday();
 assert.match(get("#student-today-content").innerHTML,/接受老師的邀請/);
});
test("student Today private data is immediately cleared on logout",()=>{
 const {app,get}=harness();init(app,"student");
 app.state.studentPortal={students:[{id:"private",name:"個人隱私",subject:"理化"}],lessons:[],schedules:[]};
 app.renderStudentToday();assert.match(get("#student-today-content").innerHTML,/個人隱私/);
 app.setUser(null);app.clearUserSessionState();
 assert.equal(get("#student-today-content").innerHTML,"");
 assert.equal(app.state.studentPortal.students.length,0);
});
