// Run from repository root: node --test tests/v3-ux-regression.mjs
// Browser-state tests run with in-memory storage and never write to Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const moduleCode=(src,names)=>new Function(src.replace(/^export (const|function)/gm,"$1")+"\nreturn {"+names.join(",")+"};")();
const modules={
 ...moduleCode(read("../v2/scheduling.js"),["expandSchedules","isVirtualOccurrence","findTimeConflicts","originalOccurrenceDate","matchesRecurrence"]),
 ...moduleCode(read("../v2/payment-ledger.js"),["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...moduleCode(read("../v2/calendar-view.js"),["monthAgendaMarkup","monthSummary"]),
 ...moduleCode(read("../v2/lesson-actual.js"),["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const appSrc=read("../v2/app.js").replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");

function createApp(){
 const nodes=new Map(),store=new Map(),lists=new Map();
 const element=id=>({
  id,style:{},value:"",dataset:{},textContent:"",innerHTML:"",open:false,hidden:false,disabled:false,checked:false,
  classList:{set:new Set(),toggle(k,v){if(v)this.set.add(k);else this.set.delete(k)},add(k){this.set.add(k)},remove(k){this.set.delete(k)},contains(k){return this.set.has(k)}},
  showModal(){this.open=true},close(){this.open=false},addEventListener(){},setAttribute(){},appendChild(){},
  querySelector(selector){return get(this.id+" "+selector)}
 });
 const get=id=>{if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id)};
 const weekdays=(prefix)=>Array.from({length:7},(_,i)=>{const el=get(prefix+" "+(i+1));el.value=String(i+1);return el});
 const document={
  activeElement:null,querySelector:get,
  querySelectorAll(sel){
   if(sel==="#record-weekdays input")return weekdays("record");
   if(sel==="#record-weekdays input:checked")return weekdays("record").filter(e=>e.checked);
   if(sel==="#schedule-weekdays input")return weekdays("schedule");
   if(sel==="#schedule-weekdays input:checked")return weekdays("schedule").filter(e=>e.checked);
   return [];
  },createElement:element,addEventListener(){}
 };
 const localStorage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
 const app=new Function("document","localStorage","crypto","confirm","console","setTimeout","FormData",...Object.keys(modules),
  appSrc+"\nrender=()=>{};return {state,loadDemo,openRecord,saveRecord,openSchedule,scheduleDates,updateRecordRepeatUI,rememberTeacherForm,"+
  "teacherStudentDefaults,refreshFormOptions,loadTeacherPreferences,initializeLive,setRole,"+
  "setUser(v){activeUser=v},setClient(v){client=v},getPreferences(){return teacherPreferences}}")(
  document,localStorage,{randomUUID:()=> "test-"+Math.random()},()=>true,console,()=>0,FormData,...Object.values(modules));
 return {app,el:id=>get("#"+id),lists,store,weekdays,document};
}

test("A student remembers its own latest rate, subject and time",async()=>{
 const {app,el}=createApp();app.loadDemo();await app.loadTeacherPreferences();
 await app.rememberTeacherForm({studentId:"demo-s2",subject:"英文進度",rate:200,start:"17:00",end:"18:00"});
 app.openRecord();
 assert.equal(el("record-student").value,"demo-s2");
 assert.equal(el("record-rate").value,200);
 assert.equal(el("record-start").value,"17:00");
 assert.equal(el("record-subject").value,"英文進度");
 assert.ok(el("record-rate-options").innerHTML.includes('value="200"'));
 app.openRecord({id:"demo-edit",student_id:"demo-s1",subject:"物理",hourly_rate:750,start_time:"15:00",end_time:"16:30",lesson_date:"2026-10-19"});
 assert.equal(el("record-rate").value,750,"Editing must respect the existing lesson value");
});

test("History suggestions stay editable and keep both 200 and 500",async()=>{
 const {app,el}=createApp();app.loadDemo();await app.loadTeacherPreferences();
 await app.rememberTeacherForm({studentId:"demo-s1",rate:200,subject:"數學"});
 await app.rememberTeacherForm({studentId:"demo-s1",rate:500,subject:"數學"});
 app.openRecord();
 assert.equal(el("record-rate").value,500);
 assert.ok(el("record-rate-options").innerHTML.includes('value="200"'));
 assert.ok(el("record-rate-options").innerHTML.includes('value="500"'));
 el("record-rate").value="650";
 assert.equal(el("record-rate").value,"650");
});

test("Monday/Wednesday/Friday weekly scheduling writes one recurring rule, not 52 lesson rows",async()=>{
 const {app,el,weekdays}=createApp();app.loadDemo();await app.loadTeacherPreferences();
 const nLessons=app.state.lessons.length,nRules=app.state.schedules.length;
 app.openRecord();
 el("record-date").value="2026-10-19";
 el("record-repeat").value="weekly";
 el("record-start").value="17:00";el("record-end").value="18:30";
 el("record-rate").value="500";el("record-subject").value="數學";
 weekdays("record").forEach(el=>el.checked=[1,3,5].includes(Number(el.value)));
 app.updateRecordRepeatUI();
 await app.saveRecord({preventDefault(){}});
 assert.equal(app.state.schedules.length,nRules+1);
 assert.equal(app.state.lessons.length,nLessons);
 const r=app.state.schedules.at(-1);
 assert.deepEqual(r.weekdays,[1,3,5]);
 assert.equal(r.every_weeks,1);
 assert.equal(r.ends_on,null);
 assert.equal(el("record-weekdays-wrap").classList.contains("hidden"),false);
});

test("Biweekly and monthly patterns continue using their intended persistence paths",()=>{
 const {app}=createApp();
 assert.deepEqual(app.scheduleDates("2026-10-20","monthly","2026-12-20"),
  ["2026-10-20","2026-11-20","2026-12-20"]);
 assert.deepEqual(app.scheduleDates("2026-10-20","biweekly","2026-11-20"),
  ["2026-10-20","2026-11-03","2026-11-17"]);
});

test("New Google accounts do not inherit another account's parent display role",async()=>{
 const {app,store}=createApp();
 store.set("tutor_v2_role","parent");
 app.state.mode="live";
 const id="user-b";
 const stub={
  auth:{async getSession(){return {data:{session:{user:{id,email:"teacherb@example.test",user_metadata:{name:"B"}}}},error:null}}},
  from(table){
   return {
    select(){return this},order(){return this},eq(){return this},
    async maybeSingle(){return {data:table==="profiles"?{id}:null,error:null}},
    async range(){return {data:[],error:null}}
   }
  }
 };
 app.setClient(stub);await app.initializeLive();
 assert.equal(app.state.role,"teacher");
 assert.equal(store.get("tutor_v2_role_user-b"),"teacher");
});
