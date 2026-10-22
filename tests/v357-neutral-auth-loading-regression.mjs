// V3.5.9: prevent a stale role from being shown during OAuth/session initialization.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appCode=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../v2/index.html",import.meta.url),"utf8");

function harness(){
 const nodes=new Map();
 function el(selector){
  if(!nodes.has(selector)){
   const attrs=new Map();
   nodes.set(selector,{
    textContent:"",innerHTML:"",hidden:false,disabled:false,value:"",open:false,
    style:{},dataset:{},
    setAttribute:(key,value)=>attrs.set(key,String(value)),
    getAttribute:key=>attrs.get(key),
    classList:{toggle(){},add(){},remove(){},contains(){return false}},
    showModal(){this.open=true},close(){this.open=false},reset(){}
   });
  }
  return nodes.get(selector);
 }
 const document={
  querySelector:el,
  querySelectorAll:()=>[],
  body:{classList:{toggle(){}}},
  activeElement:null
 };
 const localStorage={getItem:()=>null,setItem(){}};
 const src=appCode.replace(/^import .* from "\.\/[^"]+";/gm,"")
  .replace(/\nmain\(\);\s*$/,"");
 const overrides=[
  "syncCurrentView=()=>{};renderRoleSettings=()=>{};renderWorkspaceUI=()=>{};",
  "renderStudentPortal=()=>{};renderSharedPlanner=()=>{};renderStudentToday=()=>{};renderStudentCalendar=()=>{};renderRecentChanges=()=>{};",
  "renderNext=()=>{};renderRecent=()=>{};renderMiniCalendar=()=>{};",
  "renderFullCalendar=()=>{};renderBilling=()=>{};renderStudents=()=>{};",
  "refreshDaySheet=()=>{};renderHomeFocus=()=>{};monthLessons=()=>[];",
  "toast=()=>{};showModal=()=>{};closeModal=()=>{};",
  "return {state,render,renderAuthUI,initializeLive,",
  "setPhase(value){authPhase=value},getPhase(){return authPhase},",
  "setUser(value){activeUser=value},setClient(value){client=value}};"
 ].join("\n");
 const api=new Function("document","localStorage","window","crypto",
  "setTimeout","FormData",src+"\n"+overrides)(
   document,localStorage,{}, {randomUUID:()=>"qa-only"},setTimeout,FormData
  );
 return {api,el};
}
test("page title and footer both show V3.5.9",()=>{
 assert.match(html,/<title>好好上課 · V3\.5\.8 家教課程管理<\/title>/);
 assert.match(html,/V3\.5\.8 · Made with care/);
 assert.doesNotMatch(html,/V3\.5\.5 家教課程管理/);
});
test("checking session hides the stale student role, including accessible labels",()=>{
 const {api,el}=harness();
 api.setUser({id:"qa-student",email:"student@example.test"});
 api.state.role="student";
 api.setPhase("ready");
 api.render();
 assert.match(el("#role-indicator-text").textContent,/學生模式/);
 api.setPhase("checking");
 api.renderAuthUI();
 assert.equal(el("#role-indicator-text").textContent,"正在確認登入身分");
 assert.equal(el("#role-indicator").disabled,true);
 assert.equal(el("#role-indicator").getAttribute("aria-label"),"正在確認登入身分");
 api.render();
 assert.equal(el("#role-indicator-text").textContent,"正在確認登入身分");
 assert.equal(el("#account-subtitle").textContent,"正在確認登入身分");
 assert.doesNotMatch(el("#role-indicator-text").textContent,/學生|老師|家長/);
});
test("teacher role reappears only after auth is ready",()=>{
 const {api,el}=harness();
 api.state.role="student";
 api.setPhase("checking");
 api.render();
 api.setUser({id:"qa-teacher",email:"teacher@example.test"});
 api.state.role="teacher";
 api.setPhase("ready");
 api.render();
 assert.match(el("#role-indicator-text").textContent,/老師模式/);
 assert.equal(el("#role-indicator").disabled,false);
 assert.equal(el("#account-subtitle").textContent,"老師模式");
 assert.doesNotMatch(el("#role-indicator-text").textContent,/學生模式/);
});
test("initializeLive resets stale student label synchronously before getSession settles",async()=>{
 const {api,el}=harness();
 api.setUser({id:"qa-student",email:"student@example.test"});
 api.state.role="student";
 api.setPhase("ready");
 api.render();
 let resolveSession;
 api.setClient({auth:{
  getSession:()=>new Promise(resolve=>{resolveSession=resolve;})
 }});
 const boot=api.initializeLive();
 assert.equal(el("#role-indicator-text").textContent,"正在確認登入身分");
 assert.equal(el("#role-indicator").disabled,true);
 await Promise.resolve();
 resolveSession({data:{session:null},error:null});
 await boot;
 assert.equal(api.getPhase(),"signedOut");
});
