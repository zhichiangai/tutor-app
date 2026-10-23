import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const code=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8");
const begin=code.indexOf("function studentCourseCounts(studentId){");
const end=code.indexOf("function resolveLesson(id)",begin);
assert.ok(begin>=0&&end>begin,"Course-count helper must exist");
const helper=code.slice(begin,end);
const today="2026-10-23";
function counts({history=[],visible=[],role="teacher",student="studentA",month=new Date(2026,9,1)}){
 const state={lessons:history,role,mode:"live",month};
 const ctx=Function("state","activeUser","dateKey","tick","visibleLessons",
   helper+"; return {studentCourseCounts,studentCourseSummary};")(state,{id:"teacherA"},()=>today,()=>new Date(2026,9,23),()=>visible);
 return {data:ctx.studentCourseCounts(student),label:ctx.studentCourseSummary(student)};
}
test("completed lessons and leave history do not count as future arrangements",()=>{
 const history=[{student_id:"studentA",owner_id:"teacherA",type:"lesson",lesson_date:"2025-01-01"},
  {student_id:"studentA",owner_id:"teacherA",type:"lesson",lesson_date:"2026-10-01"},
  {student_id:"studentA",owner_id:"teacherA",type:"leave",lesson_date:"2026-10-20"}];
 const result=counts({history,visible:history});
 assert.deepEqual(result.data,{completed:2,leave:1,future:0});
 assert.match(result.label,/已完成 2 堂 · 本月未來預排 0 堂 · 已請假／取消 1 堂/);
});
test("future arrangements are scoped to selected calendar month and not other students",()=>{
 const planned=[{student_id:"studentA",type:"planned",lesson_date:"2026-10-24"},
   {student_id:"studentA",type:"planned",lesson_date:"2026-11-02"},
   {student_id:"studentA",type:"planned",lesson_date:"2026-10-01"},
   {student_id:"studentB",type:"planned",lesson_date:"2026-10-25"}];
 const result=counts({visible:planned});
 assert.equal(result.data.future,1);
 const november=counts({visible:planned,month:new Date(2026,10,1)});
 assert.equal(november.data.future,1);
});
test("teacher totals do not mix other teachers or students",()=>{
 const history=[{student_id:"studentA",owner_id:"teacherA",type:"lesson"},
   {student_id:"studentA",owner_id:"teacherB",type:"lesson"},
   {student_id:"studentB",owner_id:"teacherA",type:"lesson"}];
 assert.equal(counts({history}).data.completed,1);
});
test("student management and student cards use the same human-readable summary",()=>{
 assert.match(code,/const courseSummary=studentCourseSummary\(s\.id\)/);
 assert.match(code,/esc\(courseSummary\)/);
 assert.match(code,/esc\(studentCourseSummary\(s\.id\)\)/);
 assert.doesNotMatch(code,/已安排 '\+enrolled\+'/);
});
