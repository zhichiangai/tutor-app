// V3.4.1: a makeup can land outside the original biweekly pattern.
// DB validates the original occurrence and target-date conflicts separately.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const libs=(path,names)=>new Function(read(path).replace(/^export /gm,"")+"\nreturn {"+names.join(",")+"};")();
const scheduling=libs("../v2/scheduling.js",["matchesRecurrence","expandSchedules","originalOccurrenceDate","findTimeConflicts","isVirtualOccurrence"]);
const others={
 ...libs("../v2/payment-ledger.js",["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst","amount"]),
 ...libs("../v2/calendar-view.js",["monthAgendaMarkup","monthSummary"]),
 ...libs("../v2/lesson-actual.js",["durationHours","actualDefaults","validateActual","isPaymentLocked"])
};
const appSource=read("../v2/app.js");
const sql=read("../supabase/migrations/20261021170000_v34_shared_integrity.sql");

test("rescheduled biweekly December 16 course may be made up December 23 while December 30 remains",()=>{
 const rule={id:"series1",teacher_id:"teacher1",student_id:"student1",subject:"物理",
  starts_on:"2026-12-16",ends_on:"2027-01-31",weekdays:[3],every_weeks:2,
  start_time:"22:30",end_time:"23:30",hourly_rate:500};
 assert.equal(scheduling.matchesRecurrence(rule,"2026-12-16"),true);
 assert.equal(scheduling.matchesRecurrence(rule,"2026-12-23"),false);
 assert.equal(scheduling.matchesRecurrence(rule,"2026-12-30"),true);
 const entries=scheduling.expandSchedules({
   schedules:[rule],lessons:[],exceptions:[{
    schedule_id:"series1",original_date:"2026-12-16",
    action:"reschedule",moved_to:"2026-12-23",remarks:"補課"
   }],
   allowedStudents:["student1"],month:new Date(2026,11,1),today:"2026-12-10"
 });
 const moved=entries.find(x=>x.lesson_date==="2026-12-23"&&x.type==="planned");
 assert.ok(moved,"a makeup class must exist on the new date");
 assert.equal(scheduling.originalOccurrenceDate(moved),"2026-12-16");
 assert.ok(entries.some(x=>x.lesson_date==="2026-12-30"&&x.type==="planned"));
 assert.ok(entries.some(x=>x.lesson_date==="2026-12-16"&&x.type==="moved"));
 assert.equal(entries.filter(x=>x.lesson_date==="2026-12-23"&&x.type==="planned").length,1);
});

test("backend validates only original recurrence day, not makeup destination; checks destination clash",()=>{
 assert.ok(sql.includes("v34_occurs(\n       v_r.starts_on,v_r.ends_on,v_r.cancelled_from,v_r.weekdays,v_r.every_weeks,v_date)"));
 assert.ok(sql.includes("v_st.teacher_id,v_st.id,v_effective,v_r.start_time,v_r.end_time"));
 assert.ok(sql.includes("補課時間衝突"));
 assert.ok(sql.includes("new.original_date"));
 assert.ok(sql.includes("new.moved_to"));
});

test("V3.4.1 UI labels clearly distinguish a one-off makeup from changing whole recurring rule",()=>{
 assert.ok(appSource.includes("單堂補課／改期"));
 assert.ok(appSource.includes("補課日期（可選非原定上課週）"));
 assert.ok(appSource.includes("可以改到其他星期或雙週的非上課週"));
 const html=read("../v2/index.html");
 assert.ok(html.includes('id="shared-course-error" role="alert"'));
 const css=read("../v2/style.css");
 assert.ok(css.includes(".shared-course-error[hidden]{display:none}"));
});

function mockApp(){
 const nodes=new Map(),warns=[],errors=[];
 const element=(id)=>{
  if(!nodes.has(id))nodes.set(id,{
   id,innerHTML:"",textContent:"",hidden:true,disabled:false,value:"",
   dataset:{},classList:{toggle(){},add(){},remove(){}},
   close(){},showModal(){},addEventListener(){},setAttribute(){}
  });
  return nodes.get(id);
 };
 const document={querySelector:element,querySelectorAll:()=>[],addEventListener(){}};
 const localStorage={getItem(){return null},setItem(){}};
 const source=appSource.replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
 const app=new Function("document","localStorage","console","setTimeout","FormData","window","crypto",
   ...Object.keys(scheduling),...Object.keys(others),
   source+"\nreturn {state,submitSharedCourse,sharedCourseError,readableWriteError,setUser(v){activeUser=v},setClient(v){client=v}};")(
   document,localStorage,{warn(...xs){warns.push(xs)},error(...xs){errors.push(xs)},log(){}},
   ()=>0,FormData,{},{randomUUID:()=>"random"},...Object.values(scheduling),...Object.values(others));
 app.state.mode="live";app.state.role="student";
 app.state.studentPortal={students:[{id:"own",name:"學生",subject:"數學"}],lessons:[],schedules:[]};
 app.setUser({id:"student-user"});
 app.state.sharedCourseDraft={action:"create_lesson",targetId:null,studentId:"own"};
 element("#shared-course-student").value="own";
 element("#shared-course-date").value="2026-11-04";
 element("#shared-course-subject").value="數學";
 element("#shared-course-start").value="19:30";
 element("#shared-course-end").value="20:30";
 return {app,element,warns,errors};
}
test("a real RPC time-conflict rejection remains visible inline after toast and is explained",async()=>{
 const {app,element,warns,errors}=mockApp();
 app.setClient({rpc:async()=>({data:null,error:{code:"P0001",message:"課程時間衝突：老師已有其他課程"}})});
 await app.submitSharedCourse({preventDefault(){}});
 assert.equal(element("#shared-course-error").hidden,false);
 assert.match(element("#shared-course-error").textContent,/時間撞期/);
 assert.match(element("#shared-course-error").textContent,/改選其他時段/);
 assert.match(element("#toast").textContent,/儲存未完成/);
 assert.ok(warns.length>=1,"expected rule rejection should be a console warning");
 assert.equal(errors.length,0,"expected rule rejection should not generate an uncaught console error");
});
test("a stale schedule revision gets a visible and human-readable refresh instruction",async()=>{
 const {app,element}=mockApp();
 app.setClient({rpc:async()=>({data:null,error:{message:"固定課表版本已變更或缺少版本資料，請重新整理"}})});
 await app.submitSharedCourse({preventDefault(){}});
 assert.equal(element("#shared-course-error").hidden,false);
 assert.match(element("#shared-course-error").textContent,/重新整理後再修改/);
});

test("V2 README is current and historical deployment guidance remains available",()=>{
 const current=read("../v2/README.md"),legacy=read("../docs/legacy-v2-readme-20261020.md");
 assert.match(current,/Vercel/);
 assert.match(current,/tutor\.rapid4grad\.com/);
 assert.match(current,/補課/);
 assert.match(legacy,/GitHub Pages/);
 assert.match(legacy,/Google Sheets/);
});
