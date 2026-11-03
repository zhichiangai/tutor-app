// Local-only GoTrue JWT + PostgREST QA classification integration acceptance.
// Requires the three reviewed candidate SQL files applied to a disposable local Supabase.
// Never connect to a hosted project or read real student/payment data.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

assert.equal(process.env.V4_QA_LOCAL_JWT_TEST,'1','opt-in required');
const root=fileURLToPath(new URL('../../',import.meta.url));
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(status.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
assert.ok(status.ANON_KEY,'Local publishable key missing');
const db=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated',
 'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],
 {encoding:'utf8'}).trim();

let checks=0;
const eq=(a,b,why)=>{assert.equal(a,b,why);checks++};
const users={};
for(const label of ['teacher','otherTeacher','parent','otherParent','student']){
 const email=`qa-${label}-${randomUUID()}@local.invalid`;
 const response=await fetch(status.API_URL+'/auth/v1/signup',{
  method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password:randomBytes(24).toString('base64url')+'aA1'})
 });
 const payload=await response.json();
 eq(response.status,200,label+' local signup');
 assert.ok(payload.access_token);checks++;
 users[label]={id:payload.user.id,email,jwt:payload.access_token};
}
const t=users.teacher,p=users.parent;
const ids=Object.fromEntries(['student','invite','lesson','legacy','whole','batchQa','batchReal'].map(k=>[k,randomUUID()]));
db(`begin;
insert into public.workspaces(owner_id) values ('${t.id}');
insert into public.students(id,teacher_id,name) values ('${ids.student}','${t.id}','Synthetic QA child');
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values ('${ids.invite}','${t.id}','${ids.student}','${p.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values ('${t.id}','${ids.student}','${p.id}','${ids.invite}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status)
 values
 ('${ids.lesson}','${t.id}','${ids.student}','2026-09-01','lesson',2,500,1000,'老師已收到'),
 ('${ids.legacy}','${t.id}','${ids.student}','2026-09-02','lesson',2,350,700,'老師已收到'),
 ('${ids.whole}','${t.id}','${ids.student}','2026-09-03','lesson',2,250,500,'未付款');
insert into public.payment_batches
 (id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
 values
 ('${ids.batchQa}','${t.id}','${ids.student}','${p.id}','2026-09-01','2026-09-01','2026-09-04',400,'confirmed','2026-09-04',now()),
 ('${ids.batchReal}','${t.id}','${ids.student}','${p.id}','2026-09-01','2026-09-01','2026-09-04',600,'confirmed','2026-09-04',now());
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values
 ('${ids.batchQa}','${ids.lesson}',400),('${ids.batchReal}','${ids.lesson}',600);
commit;`);

async function req(actor,method,path,body){
 const token=actor?.jwt||status.ANON_KEY;
 const response=await fetch(status.API_URL+'/rest/v1/'+path,{
  method,headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,
   'Content-Type':'application/json',Prefer:'return=representation'},
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 });
 const raw=await response.text();let json;
 try{json=raw?JSON.parse(raw):null}catch{json={unparseable:raw.slice(0,150)}}
 checks++;
 return {status:response.status,body:json};
}
const qaReason='Synthetic payment batch was never transferred to any bank';
const payload={batch_id:ids.batchQa,is_qa:true,reason:qaReason,classified_by:users.otherTeacher.id};
for(const actor of [null,users.otherTeacher,p,users.otherParent,users.student]){
 const r=await req(actor,'POST','v4_payment_batch_qa_marks?select=batch_id',payload);
 assert.notEqual(r.status,201,'Unauthorized actor marked batch: '+(actor?.email||'anon'));
}
let result=await req(t,'POST','v4_payment_batch_qa_marks?select=batch_id,classified_by',payload);
eq(result.status,201,JSON.stringify(result.body));
eq(result.body[0].classified_by,t.id,'Classification actor must be from real JWT, not POST body');

for(const actor of [p,users.otherTeacher,users.student]){
 const r=await req(actor,'GET','v4_payment_batch_qa_marks?select=batch_id,reason');
 eq(r.status,200,'RLS SELECT should return no protected rows');
 eq(r.body.length,0,'Only the owning teacher can read QA reasons');
}
const legacyReason='Old direct receipt is a synthetic test, no bank deposit';
result=await req(t,'POST','v4_lesson_qa_marks?select=lesson_id,classification',{
 lesson_id:ids.legacy,classification:'simulated_legacy_receipt',
 is_qa:true,reason:legacyReason,classified_by:users.otherTeacher.id
});
eq(result.status,201,JSON.stringify(result.body));
result=await req(t,'POST','v4_lesson_qa_marks?select=lesson_id,classification',{
 lesson_id:ids.whole,classification:'simulated_lesson',
 is_qa:true,reason:'Entire synthetic lesson must never enter official totals',
 classified_by:t.id
});
eq(result.status,201,JSON.stringify(result.body));
// A confirmed real receipt must never be hidden with a whole-lesson QA mark.
const conceal=await req(t,'POST','v4_lesson_qa_marks?select=lesson_id',{
 lesson_id:ids.lesson,classification:'simulated_lesson',
 is_qa:true,reason:'Unsafe attempt to hide confirmed real money',
 classified_by:t.id
});
assert.notEqual(conceal.status,201,'Unclassified real confirmed transfer must block whole QA mark');

async function snapshot(actor){
 return req(actor,'POST','rpc/v4_accounting_qa_snapshot',{});
}
result=await snapshot(t);eq(result.status,200,JSON.stringify(result.body));
eq(result.body.qaBatchIds.length,1);
eq(result.body.qaBatchIds[0],ids.batchQa);
eq(result.body.qaLessonIds[0],ids.whole);
eq(result.body.qaLegacyReceiptLessonIds[0],ids.legacy);
assert.ok(!JSON.stringify(result.body).includes(qaReason),'Snapshot cannot include reasons');checks++;

result=await snapshot(p);eq(result.status,200);
eq(result.body.qaBatchIds[0],ids.batchQa);
eq(result.body.qaLessonIds[0],ids.whole);
eq(result.body.qaLegacyReceiptLessonIds[0],ids.legacy);
for(const actor of [users.otherTeacher,users.otherParent,users.student]){
 const r=await snapshot(actor);eq(r.status,200);
 eq(r.body.qaBatchIds.length,0);
 eq(r.body.qaLessonIds.length,0);
 eq(r.body.qaLegacyReceiptLessonIds.length,0);
}
result=await snapshot(null);assert.notEqual(result.status,200,'anon must never call snapshot');checks++;
eq(db(`select count(*) from tutor_private.v4_payment_batch_qa_audit
 where batch_id='${ids.batchQa}' and actor_id='${t.id}'`),'1');
eq(db(`select count(*) from tutor_private.v4_lesson_qa_audit
 where actor_id='${t.id}'`),'2');
// Existing guardian unlink MUST revoke snapshot in the same authenticated JWT.
db(`delete from public.student_guardians where student_id='${ids.student}' and guardian_id='${p.id}'`);
result=await snapshot(p);eq(result.status,200);
eq(result.body.qaBatchIds.length,0);
eq(result.body.qaLessonIds.length,0);
eq(result.body.qaLegacyReceiptLessonIds.length,0);
result=await snapshot(t);eq(result.status,200);
eq(result.body.qaBatchIds.length,1,'Teacher retains historical audit access');

console.log(JSON.stringify({result:'PASS',realLocalJWT:5,assertions:checks,productionWrites:0,host:'localhost'}));
