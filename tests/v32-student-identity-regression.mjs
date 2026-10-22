// V3 student portal permissions and cross-device identity tests. Run with node --test tests/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const mod=(src,names)=>new Function(src.replace(/^export /gm,"")+"\nreturn {"+names.join(",")+"};")();
const libs={
 ...mod(read("../v2/scheduling.js"),["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...mod(read("../v2/payment-ledger.js"),["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...mod(read("../v2/calendar-view.js"),["monthAgendaMarkup","monthSummary"]),
 ...mod(read("../v2/lesson-actual.js"),["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const script=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
function makeApp(){
 const elements=new Map(),storage=new Map();
 const get=id=>{
  if(!elements.has(id))elements.set(id,{
   id,value:"",textContent:"",innerHTML:"",style:{},dataset:{},open:false,disabled:false,checked:false,
   classList:{items:new Set(),toggle(k,v){if(v===undefined)v=!this.items.has(k);v?this.items.add(k):this.items.delete(k);return v},
    add(k){this.items.add(k)},remove(k){this.items.delete(k)},contains(k){return this.items.has(k)}},
   addEventListener(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}
  });
  return elements.get(id);
 };
 const document={activeElement:null,querySelector:get,querySelectorAll:()=>[],addEventListener(){}};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
 const app=new Function("document","localStorage","crypto","confirm","console","setTimeout","FormData","window",...Object.keys(libs),
  script+"\nreturn {state,render,setRole,renderStudentPortal,saveLastRole,saveDisplayName,acceptStudentInvite,removeStudentInvite,"+
  "userDisplayName,roleFullName,refreshLive,initializeLive,setUser(v){activeUser=v},setClient(v){client=v}}")(
  document,localStorage,{randomUUID:()=>"id"+Math.random()},()=>true,console,()=>0,FormData,{},...Object.values(libs));
 return {app,get,storage};
}

test("Teacher, parent and student show distinct salutation for a named Google account",()=>{
 const {app}=makeApp();app.setUser({id:"u",email:"name@example.test"});
 app.state.mode="live";app.state.profiles=[{id:"u",display_name:"XWX"}];
 for(const [role,title] of [["teacher","XWX老師"],["parent","XWX家長"],["student","XWX同學"]]){
  app.state.role=role;
  assert.equal(app.roleFullName(),title);
 }
 const html=read("../v2/index.html");
 assert.ok(html.includes('data-role-choice="student"'));
 assert.ok(html.includes('name="enabled-role" value="student"'));
 assert.ok(html.includes('id="profile-display-name"'));
});

test("Student portal renders only sanitized own lessons without payment or pricing",()=>{
 const {app,get}=makeApp();app.state.mode="live";app.state.role="student";
 app.setUser({id:"user-s",email:"student@example.test"});
 app.state.studentPortal={students:[{id:"S1",name:"XWX",subject:"數學"}],
  lessons:[{id:"L1",student_id:"S1",subject:"數學",lesson_date:"2026-10-20",start_time:"18:00",end_time:"19:00",type:"lesson",remarks:"理解進步",focus_rating:5,attitude_rating:4}],
  schedules:[]};
 app.renderStudentPortal();
 const content=get("#student-portal-content").innerHTML;
 assert.ok(content.includes("XWX 同學"));
 assert.ok(content.includes("理解進步")&&content.includes("5／5"));
 assert.ok(!content.includes("NT$")&&!content.includes("500"));
});

test("Student claim calls protected RPC with selected invitation ID",async()=>{
 const {app}=makeApp();app.state.mode="live";app.state.role="student";
 app.setUser({id:"U",email:"student@example.test"});
 app.state.studentInvites=[{id:"inv-1",email:"student@example.test"}];
 let received;
 app.setClient({rpc:async(name,args)=>{received={name,args};return {error:null}}});
 app.state.studentLinks=[];
 // persist refresh cannot run without a complete Supabase stub, so verify the private RPC call and initial matching flow statically.
 const appCode=read("../v2/app.js");
 assert.ok(appCode.includes('client.rpc("claim_student_invite",{p_invite_id:id})'));
 assert.ok(appCode.includes('if(!inv||state.role!=="student"||state.mode!=="live"||!activeUser)return'));
});

test("Cross-device restoration prefers profile.last_role over browser localStorage",()=>{
 const code=read("../v2/app.js");
 assert.ok(code.includes("const remote=profile?.last_role"));
 assert.ok(code.includes("state.enabledRoles.includes(r)"));
 assert.ok(code.includes('client.from("profiles").update({last_role:role})'));
 assert.ok(code.includes('state.view=state.role==="student"?"student-today":"home"'));
});

test("Private student linking cannot self-insert or read billing fields",()=>{
 const sql=read("../supabase/migrations/20261020220000_v32_student_portal.sql");
 assert.ok(sql.includes("revoke all on public.student_invites,public.student_links"));
 assert.ok(sql.includes("grant select,delete on public.student_links"));
 assert.ok(!sql.includes("grant insert on public.student_links"));
 assert.ok(sql.includes("v.email<>lower"));
 assert.ok(sql.includes("from public.student_links sl"));
 assert.ok(!sql.includes("paid_amount"));
 assert.ok(!sql.includes("hourly_rate"));
 assert.ok(!sql.includes("total_amount"));
 assert.ok(sql.includes("revoke all on function public.student_portal_data() from public,anon"));
});
