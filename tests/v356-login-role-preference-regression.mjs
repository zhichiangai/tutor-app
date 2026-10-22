// V3.5.6: exercise the real login flow with fake authenticated profiles.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {expandSchedules} from "../v2/scheduling.js";
import {lessonAllocation} from "../v2/payment-ledger.js";

const source=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8")
 .replace(/^import .* from "\\.\\/[^"]+";/gm,"")
 .replace(/\\nmain\\(\\);\\s*$/,"");

function harness({role=null,cached=null,pending=false,roles=["teacher","student"],
 student=true,parent=false,teacherWorkspace=true,account="qa-student"}={}){
 const store=new Map();
 const roleKey="tutor_v2_role_"+account;
 const pendingKey="tutor_v2_role_pending_"+account;
 if(cached)store.set(roleKey,cached);
 if(pending)store.set(pendingKey,"1");
 const storage={
  getItem:key=>store.get(key)||null,
  setItem:(key,value)=>store.set(key,String(value))
 };
 const dom=new Map();
 function element(key){
  if(!dom.has(key))dom.set(key,{
   value:"",innerHTML:"",textContent:"",hidden:false,open:false,
   classList:{add(){},remove(){},toggle(){},contains(){return false}},
   setAttribute(){},reset(){},close(){},showModal(){},addEventListener(){}
  });
  return dom.get(key);
 }
 const doc={querySelector:element,querySelectorAll:()=>[],body:{classList:{toggle(){}}}};
 const updates=[];
 const user={id:account,email:account+"@example.test",user_metadata:{name:"QA"}};
 const profile={id:account,roles_configured:true,enabled_roles:roles,last_role:role};
 const client={
  auth:{getSession:async()=>({data:{session:{user}},error:null})},
  from(table){
   assert.equal(table,"profiles");
   return {update(patch){
    updates.push(patch);
    return {eq(){return this},select(){return this},single:async()=>({data:{id:account},error:null})};
   }};
  }
 };
 const overrides=[
  "render=()=>{};renderAuthUI=()=>{};toast=()=>{};",
  "showModal=()=>{};closeModal=()=>{};",
  "ensureMyProfile=async()=>{};loadTeacherPreferences=async()=>{};",
  "refreshLive=async()=>{state.profiles=[profile];",
  "state.enabledRoles=profile.enabled_roles;",
  "state.workspaces=teacherWorkspace?[{owner_id:user.id,name:'QA'}]:[];",
  "state.studentLinks=student?[{user_id:user.id,student_id:'qa-child'}]:[];",
  "state.studentInvites=[];",
  "state.guardians=parent?[{guardian_id:user.id,student_id:'qa-child'}]:[];",
  "state.invites=[];};",
  "return {state,initializeLive,setRole,changeDefaultLoginRole,setClient(v){client=v}};"
 ].join("\\n");
 const app=new Function("document","localStorage","window","crypto","setTimeout",
  "FormData","expandSchedules","lessonAllocation","profile","user","student","parent",
  "teacherWorkspace",source+"\\n"+overrides)(
   doc,storage,{}, {randomUUID:()=> "qa-id"},setTimeout,FormData,
   expandSchedules,lessonAllocation,profile,user,student,parent,teacherWorkspace
  );
 app.setClient(client);
 return {app,updates,store,roleKey,pendingKey,element};
}
async function boot(config){
 const fixture=harness(config);
 await fixture.app.initializeLive();
 return fixture;
}
test("new linked student with an empty teacher workspace lands on Student Today",async()=>{
 const f=await boot();
 assert.equal(f.app.state.role,"student");
 assert.equal(f.app.state.view,"student-today");
 assert.equal(f.app.state.preferredLoginRole,"student");
 assert.equal(f.updates.length,0,"automatic inference must not persist as an explicit preference");
});
test("teacher and parent with no explicit preference reach their own Today",async()=>{
 const teacher=await boot({roles:["teacher"],student:false});
 assert.equal(teacher.app.state.role,"teacher");
 assert.equal(teacher.app.state.view,"home");
 const parent=await boot({roles:["teacher","parent"],student:false,parent:true});
 assert.equal(parent.app.state.role,"parent");
 assert.equal(parent.app.state.view,"home");
});
test("explicit server preference wins stale device cache",async()=>{
 const f=await boot({role:"student",cached:"teacher"});
 assert.equal(f.app.state.role,"student");
 assert.equal(f.store.get(f.roleKey),"student");
});
test("explicit teacher preference is respected even for a linked student",async()=>{
 const f=await boot({role:"teacher",cached:"student"});
 assert.equal(f.app.state.role,"teacher");
 assert.equal(f.app.state.view,"home");
});
test("unsynced user choice wins stale server role and is retried",async()=>{
 const f=await boot({role:"teacher",cached:"student",pending:true});
 assert.equal(f.app.state.role,"student");
 assert.equal(f.app.state.view,"student-today");
 assert.ok(f.updates.some(p=>p.last_role==="student"));
 assert.equal(f.store.get(f.pendingKey),"0");
});
test("cached role from another Google account must never be reused",async()=>{
 const f=harness({role:null,student:false,roles:["teacher","student"],account:"B"});
 f.store.set("tutor_v2_role_A","student");
 await f.app.initializeLive();
 assert.equal(f.app.state.role,"teacher");
});
test("manual role switch persists an account-scoped preference",async()=>{
 const f=await boot({role:"teacher"});
 f.app.setRole("student");
 assert.equal(f.app.state.role,"student");
 assert.equal(f.app.state.view,"student-today");
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(f.store.get(f.roleKey),"student");
 assert.equal(f.store.get(f.pendingKey),"0");
 assert.ok(f.updates.some(p=>p.last_role==="student"));
});
test("settings lets the user select a next-login role without changing the current page",async()=>{
 const f=await boot({role:"student"});
 f.element("#default-login-role").value="teacher";
 await f.app.changeDefaultLoginRole();
 assert.equal(f.app.state.role,"student");
 assert.equal(f.app.state.preferredLoginRole,"teacher");
 assert.ok(f.updates.some(p=>p.last_role==="teacher"));
 assert.equal(f.store.get(f.pendingKey),"0");
});
test("rapid switches save last selected role in order",async()=>{
 const f=await boot({role:"teacher"});
 f.app.setRole("student");
 f.app.setRole("teacher");
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(f.updates.map(x=>x.last_role),["student","teacher"]);
 assert.equal(f.store.get(f.pendingKey),"0");
 assert.equal(f.store.get(f.roleKey),"teacher");
});
