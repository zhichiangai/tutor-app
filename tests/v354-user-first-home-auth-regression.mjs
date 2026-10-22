// V3.5.4: The screen speaks to a teacher or parent, not to an API consumer.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {expandSchedules} from "../v2/scheduling.js";
import {lessonAllocation} from "../v2/payment-ledger.js";

const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");

function harness(){
 const elements=new Map();
 const querySelector=(selector)=>{
  if(!elements.has(selector))elements.set(selector,{
   innerHTML:"",textContent:"",value:"",hidden:false,open:false,
   style:{},classList:{toggle(){},add(){},remove(){},contains(){return false}},
   reset(){},setAttribute(){},showModal(){this.open=true},close(){this.open=false}
  });
  return elements.get(selector);
 };
 const document={
  querySelector,querySelectorAll:()=>[],
  body:{classList:{toggle(){}}},activeElement:null
 };
 const localStorage={getItem(){return null},setItem(){}};
 const window={};
 const code=app.replace(/^import .* from "\.\/[^"]+";/gm,"")
               .replace(/\nmain\(\);\s*$/,"");
 const api=new Function("document","localStorage","window","crypto","setTimeout",
  "FormData","expandSchedules","lessonAllocation",
  code+"\nrender=()=>renderAuthUI();return {state,renderHomeFocus,renderAuthUI,"+
  "initializeLive,getAuthPhase(){return authPhase},setAuthPhase(x){authPhase=x},"+
  "setUser(x){activeUser=x},getUser(){return activeUser},setClient(x){client=x}};")(
  document,localStorage,window,{randomUUID:()=>"test-only"},()=>0,FormData,expandSchedules,lessonAllocation);
 return {api,el:querySelector};
}
function ymd(d){const t=new Date(d);return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0")}
const today=ymd(new Date());
const tomorrow=ymd(new Date(Date.now()+86400000));

test("welcome copy describes what people can do, without OAuth or database jargon",()=>{
 for(const phrase of ["歡迎來到好好上課","老師安排課程","家長了解孩子的學習","學生回顧每次進步","使用 Google 帳號繼續"])
  assert.ok(html.includes(phrase),phrase);
 assert.ok(html.includes('id="login-progress"'));
 assert.ok(html.includes('id="login-retry"'));
 assert.ok(!html.includes("登入後可前往「設定」修改名稱、家教空間"));
 assert.match(css,/\.login-progress\[hidden\]/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test("initial session check shows friendly loading instead of misleading signed-out message",async()=>{
 const {api,el}=harness();
 let complete;
 api.setClient({auth:{getSession:()=>new Promise(resolve=>{complete=resolve})}});
 const start=api.initializeLive();
 assert.equal(api.getAuthPhase(),"checking");
 assert.equal(el("#login-progress").hidden,false);
 assert.equal(el("#google-login").hidden,true);
 assert.match(el("#login-heading").textContent,/正在為你準備/);
 assert.ok(!el("#login-description").textContent.includes("OAuth"));
 assert.equal(el("#account-modal").open,true);
 complete({data:{session:null},error:null});
 await start;
 assert.equal(api.getAuthPhase(),"signedOut");
 assert.equal(el("#login-progress").hidden,true);
 assert.equal(el("#google-login").hidden,false);
 assert.equal(el("#account-modal").open,true);
});

test("failed login data load offers a retry using ordinary language",async()=>{
 const {api,el}=harness();
 api.setClient({auth:{getSession:async()=>({data:{session:null},error:new Error("Cannot connect")})}});
 await api.initializeLive();
 assert.equal(api.getAuthPhase(),"error");
 assert.equal(el("#login-retry").hidden,false);
 assert.equal(el("#google-login").hidden,true);
 assert.match(el("#login-description").textContent,/請再試一次/);
});

test("parent overview shows linked child's next lesson, feedback and separate payment stages",()=>{
 const {api,el}=harness();
 api.setUser({id:"parent-A",email:"p@test.invalid"});
 api.state.mode="live";api.state.role="parent";
 api.state.students=[
  {id:"s1",name:"孩子甲",subject:"數學",teacher_id:"teacher-A"},
  {id:"s2",name:"另一家庭的孩子",subject:"自然",teacher_id:"teacher-B"}
 ];
 api.state.guardians=[{guardian_id:"parent-A",student_id:"s1",teacher_id:"teacher-A"}];
 api.state.lessons=[
  {id:"done-A",student_id:"s1",owner_id:"teacher-A",lesson_date:today,start_time:"09:00",end_time:"10:00",
   type:"lesson",status:"未付款",subject:"數學",lesson_content:"練習應用題",focus_rating:4,mood_rating:5,
   hourly_rate:625,hours:1,total_amount:625},
  {id:"next-A",student_id:"s1",owner_id:"teacher-A",lesson_date:tomorrow,start_time:"15:00",end_time:"16:00",
   type:"planned",subject:"數學"},
  {id:"other-B",student_id:"s2",owner_id:"teacher-B",lesson_date:today,start_time:"10:00",end_time:"11:00",
   type:"lesson",status:"未付款",subject:"自然",lesson_content:"PRIVATE OTHER FAMILY",total_amount:9000}
 ];
 api.renderHomeFocus();
 const body=el("#home-focus").innerHTML;
 for(const term of ["孩子甲","下一堂課","最近一次學習","練習應用題","專注度","學生心情",
  "本月費用","尚待回報付款","已回報，等老師確認","老師已確認收到","NT$ 625"]){
  assert.ok(body.includes(term),term);
 }
 assert.ok(body.includes('data-view="calendar"'));
 assert.ok(body.includes('data-view="students"'));
 assert.ok(body.includes('data-view="billing"'));
 assert.ok(!body.includes("另一家庭的孩子"));
 assert.ok(!body.includes("PRIVATE OTHER FAMILY"));
 assert.ok(!body.includes("9,000"));
});

test("parent without linked children gets a meaningful next step rather than an empty home",()=>{
 const {api,el}=harness();
 api.setUser({id:"parent-A"});
 api.state.mode="live";api.state.role="parent";
 api.renderHomeFocus();
 const output=el("#home-focus").innerHTML;
 assert.match(output,/還沒有連結孩子的課程/);
 assert.match(output,/請先接受老師的邀請/);
 assert.match(output,/查看孩子的學習/);
});

test("teacher home exposes today, missing feedback and pending payment actions",()=>{
 const {api,el}=harness();
 api.setUser({id:"teacher-A"});
 api.state.mode="live";api.state.role="teacher";
 api.state.students=[{id:"s1",name:"測試學生",teacher_id:"teacher-A"}];
 api.state.lessons=[{
  id:"lesson-done",student_id:"s1",owner_id:"teacher-A",lesson_date:today,start_time:"17:00",
  type:"lesson",status:"未付款",subject:"國文",total_amount:600,lesson_content:"",focus_rating:null,mood_rating:null
 }];
 api.state.paymentBatches=[{id:"batch-one",teacher_id:"teacher-A",status:"pending"}];
 api.renderHomeFocus();
 const output=el("#home-focus").innerHTML;
 for(const term of ["今天有什麼要處理","今天的課程","待補寫的上課紀錄","等你確認的收款",
  "測試學生","補寫課後紀錄"]){assert.ok(output.includes(term),term)}
 assert.ok(output.includes('data-action="open-lesson" data-id="lesson-done"'));
 assert.ok(output.includes('data-view="billing"'));
 assert.ok(output.includes('data-view="calendar"'));
});

test("teacher and parent dashboard layout remains readable on narrow screens",()=>{
 assert.match(css,/\.home-focus-grid,\.home-parent-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:650px\)\s*\{[\s\S]*?\.home-focus-grid,\.home-parent-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.ok(html.includes('id="home-focus"'));
 assert.ok(html.includes('id="home-grid"'));
 assert.ok(html.includes("V3.5.4 · Made with care."));
});
