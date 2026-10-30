import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../v2/payment-ledger.js',import.meta.url),'utf8').replace(/^export /gm,'');
const context={};
vm.runInNewContext(source+'\nthis.ledger={lessonAllocation,eligiblePeriodLessons,allocateOldestFirst};',context);
const {lessonAllocation,eligiblePeriodLessons}=context.ledger;
const lesson={id:'lesson-a',type:'lesson',student_id:'student-a',
 lesson_date:'2026-10-16',start_time:'17:00',total_amount:1000,status:'老師已收到'};
const twoBatches=[{id:'qa-part',status:'confirmed'},{id:'real-part',status:'confirmed'}];
const twoItems=[
 {batch_id:'qa-part',lesson_id:'lesson-a',allocated_amount:400},
 {batch_id:'real-part',lesson_id:'lesson-a',allocated_amount:600}
];
const calc=(batches=twoBatches,items=twoItems,qaTags={})=>lessonAllocation(lesson,batches,items,[],[],[],qaTags);

test('unclassified same-lesson partial payments count the lesson only once',()=>{
 const a=calc();
 assert.equal(a.total,1000);
 assert.equal(a.confirmed,1000);
 assert.equal(a.available,0);
});

test('simulated batch does not count as real confirmed receipt',()=>{
 const a=calc(twoBatches,twoItems,{qaBatchIds:['qa-part']});
 assert.equal(a.total,1000);
 assert.equal(a.confirmed,600);
 assert.equal(a.pending,0);
 assert.equal(a.available,400);
 assert.equal(a.qaExcluded,false);
});

test('two simulated batches cannot turn simulated money into real cash',()=>{
 const a=calc(twoBatches,twoItems,{qaBatchIds:['qa-part','real-part']});
 assert.equal(a.total,1000);
 assert.equal(a.confirmed,0);
 assert.equal(a.available,1000);
});

test('QA batch is ignored for pending as well as confirmed',()=>{
 const batches=[{id:'qa-part',status:'pending'},{id:'real-part',status:'confirmed'}];
 const a=calc(batches,twoItems,{qaBatchIds:['qa-part']});
 assert.equal(a.confirmed,600);
 assert.equal(a.pending,0);
 assert.equal(a.available,400);
});

test('legacy single-lesson receipt remains unless explicitly classified simulated',()=>{
 const original=calc([],[]);
 assert.equal(original.confirmed,1000);
 assert.equal(original.available,0);
 const classified=calc([],[],{qaLegacyReceiptLessonIds:['lesson-a']});
 assert.equal(classified.confirmed,0);
 assert.equal(classified.available,1000);
 assert.equal(classified.total,1000);
});

test('whole simulated lesson is excluded from tuition and receipts',()=>{
 const classified=calc(twoBatches,twoItems,{qaLessonIds:['lesson-a']});
 assert.equal(classified.total,0);
 assert.equal(classified.confirmed,0);
 assert.equal(classified.pending,0);
 assert.equal(classified.available,0);
 assert.equal(classified.qaExcluded,true);
});

test('period payment query never allocates against whole simulated lessons',()=>{
 const result=eligiblePeriodLessons({
  lessons:[lesson],batches:twoBatches,items:twoItems,
  studentId:'student-a',start:'2026-10-01',end:'2026-10-31',
  qaTags:{qaLessonIds:['lesson-a']}
 });
 assert.equal(result.length,0);
});

test('without database-provided QA classification legacy behavior is preserved',()=>{
 const left=calc();
 const right=calc(twoBatches,twoItems,{});
 for(const k of ['total','confirmed','pending','available','legacyPending'])assert.equal(left[k],right[k],k);
});

test('QA tags cannot leak to another lesson',()=>{
 const a=calc(twoBatches,twoItems,{qaBatchIds:['unrelated'],qaLessonIds:['elsewhere'],qaLegacyReceiptLessonIds:['elsewhere']});
 assert.equal(a.confirmed,1000);
});
