// V3.5.9 protects OAuth first paint and scopes display preferences per account.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const html=read("../v2/index.html");
const css=read("../v2/style.css");
const appCode=read("../v2/app.js");

function createHarness(){
 const values=new Map(),nodes=new Map(),classes=new Set();
 function node(selector){
  if(!nodes.has(selector)){
   const attrs=new Map();
   nodes.set(selector,{textContent:"",innerHTML:"",value:"",disabled:false,hidden:false,
    style:{},dataset:{},
    setAttribute:(k,v)=>attrs.set(k,String(v)),getAttribute:k=>attrs.get(k),
    classList:{toggle(){},add(){},remove(){},contains(){return false}},
    showModal(){},close(){},reset(){}});
  }
  return nodes.get(selector);
 }
 const body={classList:{toggle(k,enabled){if(enabled)classes.add(k);else classes.delete(k)}}};
 const document={body,querySelector:node,querySelectorAll:()=>[],activeElement:null};
 const localStorage={
  getItem:key=>values.has(key)?values.get(key):null,
  setItem:(key,val)=>values.set(key,String(val))
 };
 const source=appCode.replace(/^import .* from "\.\/[^"]+";/gm,"")
  .replace(/\nmain\(\);\s*$/,"");
 const overrides=[
  "syncCurrentView=()=>{};renderRoleSettings=()=>{};renderWorkspaceUI=()=>{};",
  "renderStudentPortal=()=>{};renderSharedPlanner=()=>{};",
  "renderStudentCalendar=()=>{};renderRecentChanges=()=>{};renderStudentToday=()=>{};",
  "renderNext=()=>{};renderRecent=()=>{};renderMiniCalendar=()=>{};",
  "renderFullCalendar=()=>{};renderBilling=()=>{};renderStudents=()=>{};",
  "refreshDaySheet=()=>{};renderHomeFocus=()=>{};monthLessons=()=>[];",
  "return {state,render,renderAuthUI,restoreCalendarMode,changeCalendarMode,clearUserSessionState,",
  "setUser(u){activeUser=u},setPhase(p){authPhase=p}};"
 ].join("\n");
 const api=new Function("document","localStorage","window","crypto",
  "setTimeout","FormData",source+"\n"+overrides)(
  document,localStorage,{}, {randomUUID:()=>"qa-only"},setTimeout,FormData);
 return {api,node,classes,values};
}
test("HTML starts on a neutral opaque auth screen before app.js loads",()=>{
 assert.match(html,/<body class="auth-pending">/);
 const startup=html.match(/<span id="role-indicator-text">([^<]+)<\/span>/)?.[1];
 assert.equal(startup,"正在確認登入身分");
 assert.match(html,/class="auth-loading-screen"/);
 assert.match(css,/body\.auth-pending \.app-shell\{visibility:hidden/);
 assert.match(css,/body\.auth-pending \.auth-loading-screen\{display:flex/);
 assert.match(html,/<title>好好上課 · V4\.0\.0-dev\.2 家教課程管理<\/title>/);
 assert.match(html,/V4 Beta · Made with care/);
});
test("checking and signed-out states never announce a teacher mode",()=>{
 const {api,node,classes}=createHarness();
 api.setUser(null);api.setPhase("checking");
 api.render();
 assert.equal(node("#role-indicator-text").textContent,"正在確認登入身分");
 assert.equal(node("#account-subtitle").textContent,"正在確認登入身分");
 assert.equal(node("#role-indicator").disabled,true);
 assert.equal(classes.has("auth-pending"),true);
 api.setPhase("signedOut");api.render();
 assert.equal(node("#role-indicator-text").textContent,"尚未登入");
 assert.doesNotMatch(node("#role-indicator").getAttribute("aria-label"),/老師|學生|家長/);
 assert.equal(node("#role-indicator").disabled,true);
 assert.equal(classes.has("auth-pending"),false);
});
test("resolved student identity appears only after session becomes ready",()=>{
 const {api,node,classes}=createHarness();
 api.setUser({id:"student-user",email:"test@example.test"});api.state.role="student";
 api.setPhase("checking");api.render();
 assert.equal(classes.has("auth-pending"),true);
 assert.doesNotMatch(node("#role-indicator-text").textContent,/學生模式/);
 api.setPhase("ready");api.render();
 assert.match(node("#role-indicator-text").textContent,/學生模式/);
 assert.equal(node("#role-indicator").disabled,false);
 assert.equal(classes.has("auth-pending"),false);
});
test("calendar mode preference belongs to each account and role",()=>{
 const {api,values}=createHarness();
 api.setUser({id:"user-a"});
 api.state.role="teacher";api.restoreCalendarMode();
 assert.equal(api.state.calendarMode,"month");
 api.changeCalendarMode("list");
 assert.equal(values.get("tutor_v22_calendar_mode_user-a_teacher"),"list");
 api.setUser({id:"user-b"});
 api.state.role="teacher";api.restoreCalendarMode();
 assert.equal(api.state.calendarMode,"month");
 api.changeCalendarMode("list");
 api.setUser({id:"user-a"});
 api.state.role="parent";api.restoreCalendarMode();
 assert.equal(api.state.calendarMode,"month");
 api.changeCalendarMode("list");
 assert.equal(values.get("tutor_v22_calendar_mode_user-a_parent"),"list");
 api.state.role="teacher";api.restoreCalendarMode();
 assert.equal(api.state.calendarMode,"list");
 assert.equal(values.has("tutor_v22_calendar_mode"),false);
});
test("logout discards the previous person's calendar mode from in-memory state",()=>{
 const {api}=createHarness();
 api.setUser({id:"qa"});api.state.role="parent";
 api.changeCalendarMode("list");
 api.clearUserSessionState();
 assert.equal(api.state.calendarMode,"month");
 assert.equal(api.state.role,"teacher");
});
