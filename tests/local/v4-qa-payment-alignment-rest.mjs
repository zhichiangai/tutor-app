// End-to-end PostgREST/GoTrue proof of real payment over historical QA transfers.
// CI disposable Supabase only; do not run against the Mac or hosted database.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

assert.equal(process.env.V4_QA_PAYMENT_ALIGNMENT_LOCAL,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const db=sql=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',sql],{encoding:'utf8'}).trim();
let checks=0;
function eq(x,y,why){assert.equal(x,y,why);checks++}
const actors={};
for(const role of ['teacher','parent','stranger']){
 const email='qa-payment-'+role+'-'+randomUUID()+'@local.invalid';
 const password=randomBytes(24).toString('base64url')+'xA1';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{
  method:'POST',headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password})});
 const data=await r.json();
 eq(r.status,200,'local signup '+role+': '+JSON.stringify(data?.msg||data?.message||r.status));
 assert.ok(data.access_token);checks++;
 actors[role]={id:data.user.id,jwt:data.access_token,email};
}
const {teacher,parent,stranger}=actors;
const ids=Object.fromEntries(['student','invite','mixed','qaBatch','legacy','whole','direct','pendingLesson','pendingBatch']
 .map(k=>[k,randomUUID()]));
db(`begin;
insert into public.workspaces(owner_id) values ('${teacher.id}');
insert into public.students(id,teacher_id,name)
 values ('${ids.student}','${teacher.id}','QA payment alignment synthetic');
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values ('${ids.invite}','${teacher.id}','${ids.student}','${parent.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values ('${teacher.id}','${ids.student}','${parent.id}','${ids.invite}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status)
 values
 ('${ids.mixed}','${teacher.id}','${ids.student}','2026-09-10','lesson',2,500,1000,'老師已收到'),
 ('${ids.legacy}','${teacher.id}','${ids.student}','2026-09-11','lesson',2,350,700,'老師已收到'),
 ('${ids.whole}','${teacher.id}','${ids.student}','2026-09-12','lesson',1,500,500,'未付款'),
 ('${ids.direct}','${teacher.id}','${ids.student}','2026-09-13','lesson',1,500,500,'老師已收到'),
 ('${ids.pendingLesson}','${teacher.id}','${ids.student}','2026-09-14','lesson',1,300,300,'未付款');
insert into public.payment_batches
 (id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
 values
 ('${ids.qaBatch}','${teacher.id}','${ids.student}','${parent.id}',
  '2026-09-10','2026-09-10','2026-09-10',400,'confirmed','2026-09-10',now()),
 ('${ids.pendingBatch}','${teacher.id}','${ids.student}','${parent.id}',
  '2026-09-14','2026-09-14','2026-09-14',300,'pending',null,null);
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values
 ('${ids.qaBatch}','${ids.mixed}',400),
 ('${ids.pendingBatch}','${ids.pendingLesson}',300);
commit;`);

async function request(actor,path,data,method='POST'){
 const r=await fetch(s.API_URL+'/rest/v1/'+path,{
  method,headers:{apikey:s.ANON_KEY,
   Authorization:'Bearer '+(actor?.jwt??s.ANON_KEY),
   'Content-Type':'application/json',
   Prefer:'return=representation'},
  ...(data===undefined?{}:{body:JSON.stringify(data)})
 });
 const body=await r.text();
 let parsed;
 try{parsed=body?JSON.parse(body):null}catch{parsed=body}
 checks++;
 return {status:r.status,data:parsed};
}
async function mark(table,value){
 const r=await request(teacher,table+'?select=*',value);
 eq(r.status,201,'QA classification: '+JSON.stringify(r.data));
}
await mark('v4_payment_batch_qa_marks',{
 batch_id:ids.qaBatch,is_qa:true,reason:'Synthetic confirmed 400, never real bank transfer'});
await mark('v4_payment_batch_qa_marks',{
 batch_id:ids.pendingBatch,is_qa:true,reason:'Synthetic pending report must never become real bank money'});
await mark('v4_lesson_qa_marks',{
 lesson_id:ids.legacy,is_qa:true,classification:'simulated_legacy_receipt',
 reason:'Legacy synthetic receipt; no actual deposit'});
await mark('v4_lesson_qa_marks',{
 lesson_id:ids.whole,is_qa:true,classification:'simulated_lesson',
 reason:'Entire lesson is a synthetic QA fixture'});

const period=(day,amount)=>({
 p_teacher_id:teacher.id,p_student_id:ids.student,
 p_period_start:day,p_period_end:day,p_paid_on:'2026-09-15',
 p_paid_amount:amount,p_note:'Verified synthetic bank payment'
});
const submit=(actor,day,amount)=>request(actor,'rpc/submit_range_payment',period(day,amount));
const confirm=(actor,batch,date='2026-09-15')=>request(actor,'rpc/review_range_payment',{
 p_batch_id:batch,p_confirm:true,p_received_on:date
});

// Unauthorized guardian cannot submit, even if they know teacher/student IDs.
let r=await submit(stranger,'2026-09-10',600);
assert.notEqual(r.status,200,'Other parent cannot report payment');checks++;

// A genuinely settled direct-receipt lesson must not accept a new parent report.
r=await submit(parent,'2026-09-13',500);
assert.notEqual(r.status,200,'Unmarked historical bank receipt must be excluded');checks++;

// Whole-QA course never creates a real payment batch.
r=await submit(parent,'2026-09-12',500);
assert.notEqual(r.status,200,'Whole-QA lesson must be excluded');checks++;

// The existing QA pending batch is prohibited from teacher real-bank confirmation.
r=await confirm(teacher,ids.pendingBatch);
assert.notEqual(r.status,204,'QA pending batch must not be confirmed as bank money');checks++;
eq(db(`select status from public.payment_batches where id='${ids.pendingBatch}'`),'pending');

// Historical QA confirmed 400 must NOT consume the real course's NT$1000.
r=await submit(parent,'2026-09-10',600);
eq(r.status,200,'NT$600 real report after QA 400: '+JSON.stringify(r.data));
const first=r.data;
assert.match(first,/^[a-f0-9-]{36}$/i);checks++;
eq(db(`select sum(i.allocated_amount)::numeric(12,2)
  from public.payment_batch_items i where i.batch_id='${first}'`),'600.00');
r=await confirm(stranger,first);
assert.notEqual(r.status,204,'Unlinked user cannot confirm bank payment');checks++;
r=await confirm(teacher,first);
eq(r.status,204,'Teacher must confirm real 600 even if previously QA-marked paid: '+JSON.stringify(r.data));
eq(db(`select status from public.lesson_records where id='${ids.mixed}'`),'未付款');
eq(db(`select count(*) from tutor_private.v4_qa_payment_review_authorizations
  where lesson_id='${ids.mixed}' and applied`),'1');

r=await submit(parent,'2026-09-10',400);
eq(r.status,200,'Remaining real 400: '+JSON.stringify(r.data));
const second=r.data;
r=await confirm(teacher,second);
eq(r.status,204,'Teacher confirms remaining 400');
eq(db(`select status from public.lesson_records where id='${ids.mixed}'`),'老師已收到');
eq(db(`select coalesce(sum(i.allocated_amount),0)::numeric(12,2)
 from public.payment_batch_items i
 join public.payment_batches b on b.id=i.batch_id
 left join public.v4_payment_batch_qa_marks q on q.batch_id=b.id and q.is_qa
 where i.lesson_id='${ids.mixed}' and b.status='confirmed' and q.batch_id is null`),'1000.00');
eq(db(`select count(*) from public.payment_batches
 where id in ('${ids.qaBatch}','${first}','${second}')`),'3');

r=await submit(parent,'2026-09-10',100);
assert.notEqual(r.status,200,'No duplicate/overpayment after real NT$1000');checks++;

// Legacy direct QA receipt is separately classified, not treated as money.
r=await submit(parent,'2026-09-11',700);
eq(r.status,200,'Classified legacy simulated receipt must be payable: '+JSON.stringify(r.data));
r=await confirm(teacher,r.data);
eq(r.status,204,'Actual teacher confirmation of corrected legacy QA');
eq(db(`select status from public.lesson_records where id='${ids.legacy}'`),'老師已收到');

// Same old parent JWT must lose direct REST access after unlink, not just UI visibility.
r=await request(parent,'payment_batches?select=id&id=eq.'+first,undefined,'GET');
eq(r.status,200);
eq(r.data.length,1,'Linked guardian can read their own real batch');
db(`delete from public.student_guardians where student_id='${ids.student}' and guardian_id='${parent.id}'`);
r=await request(parent,'payment_batches?select=id&id=eq.'+first,undefined,'GET');
eq(r.status,200);
eq(r.data.length,0,'Unlinked guardian old JWT must lose access to historical batch');
r=await submit(parent,'2026-09-10',100);
assert.notEqual(r.status,200,'Unlinked guardian must not report more payments');checks++;
console.log(JSON.stringify({result:'PASS',realLocalJWT:3,assertions:checks,
 syntheticOnly:true,bankAllocation:1000,qaExcluded:400,
 legacyReceiptReconciled:true,oldJWTRevoked:true,productionWrites:0}));
