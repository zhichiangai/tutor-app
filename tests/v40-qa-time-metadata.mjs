import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');
function snippet(name,next){
 const start=code.indexOf(`function ${name}(`),end=code.indexOf(`function ${next}(`,start);
 assert.ok(start>=0&&end>start);
 return code.slice(start,end);
}

test('teacher financial totals never include QA even when test rows are shown',()=>{
 const students=[{id:'qa',is_qa:true},{id:'real',is_qa:false}];
 const state={role:'teacher',mode:'live',showQaAccounting:false,students,qaTags:{qaBatchIds:['marked-qa'],qaLessonIds:['marked-lesson']},
  paymentBatches:[{id:'q',student_id:'qa',teacher_id:'teacher',created_at:'2026-10-02'},
   {id:'r',student_id:'real',teacher_id:'teacher',created_at:'2026-10-01'},
   {id:'marked-qa',student_id:'real',teacher_id:'teacher',created_at:'2026-10-03'}]};
 const isQaBatch=b=>b.student_id==='qa'||state.qaTags.qaBatchIds.includes(b.id);
 const {inOfficialAccounting,visiblePaymentBatches}=new Function(
  'state','activeUser','studentFor','asText','isQaBatch',
  snippet('inOfficialAccounting','monthLessons')+snippet('visiblePaymentBatches','renderPaymentHistory')+
  ';return {inOfficialAccounting,visiblePaymentBatches}')(state,{id:'teacher'},
  l=>students.find(s=>s.id===l.student_id),String,isQaBatch);
 assert.equal(inOfficialAccounting({id:'lesson-qa-student',student_id:'qa'}),false);
 assert.equal(inOfficialAccounting({id:'marked-lesson',student_id:'real'}),false);
 assert.equal(inOfficialAccounting({id:'good-lesson',student_id:'real'}),true);
 assert.deepEqual(visiblePaymentBatches().map(b=>b.id),['r']);
 state.showQaAccounting=true;
 assert.equal(inOfficialAccounting({id:'lesson-qa-student',student_id:'qa'}),false,
  'show QA toggles detail rows, not official totals');
 assert.deepEqual(visiblePaymentBatches().map(b=>b.id),['marked-qa','q','r']);
 assert.match(code,/const official=monthCompleted\.filter\(inOfficialAccounting\)/);
 assert.match(code,/const billed=official\.reduce/);
 assert.match(code,/const confirmed=official\.reduce/);
});

test('time estimate is explicit and is displayed in teacher/parent lesson rows',()=>{
 assert.match(code,/record-estimated"\)\.checked=lesson\?\.time_accuracy==="estimated"/);
 assert.match(code,/time_accuracy:\$\("#record-estimated"\)\.checked\?"estimated":"recorded"/);
 assert.match(code,/l\.time_accuracy==="estimated"\?' · 時間為估計'/);
 assert.match(code,/data-action="toggle-estimated"/);
});
