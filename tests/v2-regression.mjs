// Run with: node --test tests/v2-regression.mjs
// Read-only tests. No Supabase credentials, network access, or production writes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const file = path => readFileSync(new URL(path, import.meta.url), "utf8");
const moduleCode = (source, names) => new Function(
  source.replace(/^export (const|function)/gm, "$1") +
  "\nreturn {" + names.join(",") + "};"
)();
const actual = moduleCode(file("../v2/lesson-actual.js"),
 ["durationHours","actualDefaults","validateActual","isPaymentLocked"]);
const ledger = moduleCode(file("../v2/payment-ledger.js"),
 ["lessonAllocation","eligiblePeriodLessons","allocateOldestFirst"]);
const schedule = moduleCode(file("../v2/scheduling.js"),
 ["matchesRecurrence","isVirtualOccurrence","expandSchedules"]);

test("unchanged planned course defaults to scheduled 2 hours",()=>{
 const d=actual.actualDefaults({type:"planned",start_time:"17:00",end_time:"19:00"});
 assert.deepEqual([d.actualStart,d.actualEnd,d.actualHours],["17:00","19:00",2]);
 assert.equal(actual.durationHours("17:30","19:00"),1.5);
});
test("decimal hours support 1.2, 1.5 and 2.5 without hh:mm confusion",()=>{
 for(const hours of [1.2,1.5,2.5])assert.equal(actual.validateActual("17:30","19:00",hours).actual_hours,hours);
 assert.throws(()=>actual.validateActual("19:00","17:30",1.5));
 assert.throws(()=>actual.validateActual("17:30","19:00",-1));
});
test("payment history locks an already-paid lesson",()=>{
 const l={id:"a",type:"lesson",status:"未付款"};
 assert.equal(actual.isPaymentLocked(l,[{id:"b",status:"pending"}],[{batch_id:"b",lesson_id:"a"}]),true);
 assert.equal(actual.isPaymentLocked({...l,status:"老師已收到"}),true);
 assert.equal(actual.isPaymentLocked(l,[],[],[]),false);
});
test("cross-month partial payment allocates oldest lessons first without overbilling",()=>{
 const lessons=[
 {id:"a",type:"lesson",student_id:"s",lesson_date:"2026-09-29",start_time:"17:00",total_amount:500},
 {id:"b",type:"lesson",student_id:"s",lesson_date:"2026-10-03",start_time:"17:00",total_amount:750}
 ];
 const params={lessons,batches:[],items:[],requests:[],studentId:"s",start:"2026-09-01",end:"2026-10-20"};
 const rows=ledger.eligiblePeriodLessons(params);
 assert.deepEqual(ledger.allocateOldestFirst(rows,800).map(x=>x.allocated_amount),[500,300]);
 const next=ledger.eligiblePeriodLessons({...params,batches:[{id:"p",status:"confirmed"}],
 items:[{batch_id:"p",lesson_id:"a",allocated_amount:500},{batch_id:"p",lesson_id:"b",allocated_amount:300}]});
 assert.equal(next.length,1);
 assert.equal(next[0].allocation.available,450);
});
test("fixed weekly schedule does not shift after an individual exception",()=>{
 const rule={id:"r",teacher_id:"t",student_id:"s",subject:"數學",starts_on:"2026-10-07",
 ends_on:"2026-11-11",weekdays:[3],every_weeks:1,start_time:"17:00",end_time:"19:00",hourly_rate:500};
 assert.equal(schedule.matchesRecurrence(rule,"2026-10-21"),true);
 assert.equal(schedule.matchesRecurrence(rule,"2026-10-22"),false);
 assert.equal(schedule.matchesRecurrence(rule,"2026-10-28"),true);
 const entries=schedule.expandSchedules({schedules:[rule],lessons:[],allowedStudents:["s"],
 exceptions:[{schedule_id:"r",original_date:"2026-10-21",action:"student_leave"}],
 month:new Date(2026,9,1),today:"2026-10-20"});
 assert.ok(entries.some(x=>x.lesson_date==="2026-10-28"&&x.type==="planned"));
});
test("Supabase read pages include rows past initial 1,000 and preserve all data",async()=>{
 const app=file("../v2/app.js");
 const begin=app.indexOf("const LIVE_TABLES=");
 const end=app.indexOf("async function ensureClient()",begin);
 assert.ok(begin>0&&end>begin,"paging helpers exist");
 const pages={
 students:Array.from({length:1201},(_,i)=>({id:"s"+i})),
 payment_batch_items:Array.from({length:1100},(_,i)=>({batch_id:"b"+i,lesson_id:"l"+i}))
 };
 const calls={};
 const client={rpc:async(name)=>({data:name==="v4_accounting_qa_snapshot"?
  {qaBatchIds:[],qaLessonIds:[],qaLegacyReceiptLessonIds:[]}: {students:[],lessons:[],schedules:[]},error:null}),from(table){return{select(){return this},order(){return this},async range(a,b){
 calls[table]=(calls[table]||0)+1;
 return {data:(pages[table]||[]).slice(a,b+1),error:null};
 }}}};
 const state={mode:"live"};
 const fn=new Function("client","activeUser","state",
 app.slice(begin,end)+"\nreturn {refreshLive};");
 await fn(client,{id:"test-teacher"},state).refreshLive();
 assert.equal(state.students.length,1201);
 assert.equal(state.paymentBatchItems.length,1100);
 assert.equal(calls.students,3);
 assert.equal(calls.payment_batch_items,3);
});
