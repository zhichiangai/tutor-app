// Real localhost GoTrue JWT / PostgREST QA-vs-real payment allocation contract.
// Never run on hosted Supabase; expected QA SQL candidates applied by CI.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.V4_QA_PAYMENT_RPC_TEST,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const db=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],{encoding:'utf8'}).trim();
const businessDate=d=>{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
 return [parts.year,parts.month,parts.day].join('-');
};
const dayA=businessDate(new Date(Date.now()-2*86400000));
const dayB=businessDate(new Date(Date.now()-86400000));
const dayC=businessDate(new Date());
let checks=0;
const eq=(a,b,m)=>{assert.equal(a,b,m);checks++};
const users={};
for(const label of ['teacher','parent','otherParent']){
 const email='qa-pay-'+label+'-'+randomUUID()+'@local.invalid';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',headers:{
  apikey:s.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({
  email,password:randomBytes(24).toString('base64url')+'aA1'})});
 const p=await r.json();eq(r.status,200,label+' GoTrue signup');
 assert.ok(p.access_token);checks++;
 users[label]={id:p.user.id,jwt:p.access_token,email};
}
const ids=Object.fromEntries(['student','invite','a','b','c','qaA','realA','qaB'].map(x=>[x,randomUUID()]));
const t=users.teacher,p=users.parent;
db(`begin;
insert into public.workspaces(owner_id) values('${t.id}');
insert into public.students(id,teacher_id,name) values('${ids.student}','${t.id}','QA and real allocation synthetic');
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values('${ids.invite}','${t.id}','${ids.student}','${p.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values('${t.id}','${ids.student}','${p.id}','${ids.invite}');
insert into public.lesson_records
 (id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status,received_date)
 values
 ('${ids.a}','${t.id}','${ids.student}','${dayA}','lesson',2,500,1000,'老師已收到','${dayA}'),
 ('${ids.b}','${t.id}','${ids.student}','${dayB}','lesson',2,500,1000,'未付款',null),
 ('${ids.c}','${t.id}','${ids.student}','${dayC}','lesson',2,500,1000,'未付款',null);
insert into public.payment_batches
 (id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
 values
 ('${ids.qaA}','${t.id}','${ids.student}','${p.id}','${dayA}','${dayA}','${dayA}',400,'confirmed','${dayA}',now()),
 ('${ids.realA}','${t.id}','${ids.student}','${p.id}','${dayA}','${dayA}','${dayA}',600,'confirmed','${dayA}',now()),
 ('${ids.qaB}','${t.id}','${ids.student}','${p.id}','${dayB}','${dayB}','${dayB}',200,'pending',null,null);
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount)
 values('${ids.qaA}','${ids.a}',400),('${ids.realA}','${ids.a}',600),('${ids.qaB}','${ids.b}',200);
commit;`);
async function rest(actor,method,path,data){
 const r=await fetch(s.API_URL+'/rest/v1/'+path,{method,
 headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+(actor?.jwt||s.ANON_KEY),
  'Content-Type':'application/json',Prefer:'return=representation'},
 ...(data===undefined?{}:{body:JSON.stringify(data)})});
 const raw=await r.text();let parsed;try{parsed=raw?JSON.parse(raw):null}catch{parsed=raw}
 checks++;return {status:r.status,data:parsed};
}
const reason='Documented synthetic transfer; no bank money was ever received';
for(const batch of [ids.qaA,ids.qaB]){
 const r=await rest(t,'POST','v4_payment_batch_qa_marks?select=batch_id',{
  batch_id:batch,is_qa:true,reason,classified_by:t.id});
 eq(r.status,201,'Teacher can mark simulated batch');
}
let r=await rest(t,'POST','v4_lesson_qa_marks?select=lesson_id',{
 lesson_id:ids.c,is_qa:true,classification:'simulated_lesson',
 reason:'Entire synthetic QA course is excluded from official tuition',classified_by:t.id});
eq(r.status,201,'QA whole-course marker');
const base=(d,amount)=>({
 p_teacher_id:t.id,p_student_id:ids.student,p_period_start:d,p_period_end:d,
 p_paid_on:dayC,p_paid_amount:amount,p_note:'Synthetic QA real-cash acceptance'
});
r=await rest(users.otherParent,'POST','rpc/submit_range_payment',base(dayA,400));
assert.notEqual(r.status,200,'Unlinked guardian must not pay a different child');checks++;
r=await rest(p,'POST','rpc/submit_range_payment',base(dayC,100));
assert.notEqual(r.status,200,'Whole QA course is never billable');checks++;
r=await rest(p,'POST','rpc/submit_range_payment',base(dayA,400));
eq(r.status,200,'Real remaining 400 must not be reserved by QA batch: '+JSON.stringify(r.data));
const real400=r.data;assert.match(real400,/^[a-f0-9-]{36}$/i);checks++;
eq(db(`select sum(i.allocated_amount)::numeric(12,2) from public.payment_batch_items i where i.batch_id='${real400}'`),'400.00');
r=await rest(users.otherParent,'POST','rpc/review_range_payment',{
 p_batch_id:real400,p_confirm:true,p_received_on:dayC});
assert.notEqual(r.status,204,'Only owning teacher may confirm');checks++;
r=await rest(t,'POST','rpc/review_range_payment',{
 p_batch_id:real400,p_confirm:true,p_received_on:dayC});
eq(r.status,204,'Teacher must be allowed to reconcile historical QA paid status: '+JSON.stringify(r.data));
eq(db(`select status from public.payment_batches where id='${real400}'`),'confirmed');
eq(db(`select status from public.lesson_records where id='${ids.a}'`),'老師已收到');
eq(db(`select count(*) from tutor_private.v4_qa_payment_review_authorizations where lesson_id='${ids.a}' and applied`),'1');
eq(db(`select coalesce(sum(i.allocated_amount),0)::numeric(12,2)
 from public.payment_batch_items i
 join public.payment_batches b on b.id=i.batch_id and b.status='confirmed'
 where i.lesson_id='${ids.a}' and not exists(
 select 1 from public.v4_payment_batch_qa_marks qm where qm.batch_id=b.id and qm.is_qa)`),'1000.00');
r=await rest(p,'POST','rpc/submit_range_payment',base(dayA,0.01));
assert.notEqual(r.status,200,'Repeated payment may not exceed real available amount');checks++;
r=await rest(t,'POST','rpc/review_range_payment',{
 p_batch_id:ids.qaB,p_confirm:true,p_received_on:dayC});
assert.notEqual(r.status,204,'Pending simulated QA batch must never be bank-confirmed');checks++;
r=await rest(p,'POST','rpc/submit_range_payment',base(dayB,1000));
eq(r.status,200,'Real full amount may ignore simulated QA pending allocation: '+JSON.stringify(r.data));
const realB=r.data;
eq(db(`select sum(allocated_amount)::numeric(12,2) from public.payment_batch_items where batch_id='${realB}'`),'1000.00');
r=await rest(t,'POST','rpc/review_range_payment',{
 p_batch_id:realB,p_confirm:true,p_received_on:dayC});
eq(r.status,204,'Teacher confirms real amount with ignored QA pending batch');
eq(db(`select status from public.lesson_records where id='${ids.b}'`),'老師已收到');
// Unmarking QA now would artificially count 1400 or 1200 of real receipts.
for(const batch of [ids.qaA,ids.qaB]){
 r=await rest(t,'PATCH','v4_payment_batch_qa_marks?batch_id=eq.'+batch,{
  is_qa:false,reason:'Reclassification would wrongly exceed the lesson tuition total'});
 assert.notEqual(r.status,204,'Cannot unmark simulated receipt after real balance fully allocated');checks++;
}
const direct=await rest(t,'PATCH','lesson_records?id=eq.'+ids.a,{
 status:'未付款',received_date:null});
assert.notEqual(direct.status,204,'Teacher direct paid-status downgrade must remain blocked');checks++;
const old=await rest(p,'GET','payment_batches?select=id&id=eq.'+real400);
eq(old.status,200);eq(old.data.length,1,'linked parent sees batch');
db(`delete from public.student_guardians where student_id='${ids.student}' and guardian_id='${p.id}'`);
const revoked=await rest(p,'GET','payment_batches?select=id&id=eq.'+real400);
eq(revoked.status,200);eq(revoked.data.length,0,'same existing JWT must lose access to old batch after unlink');
r=await rest(p,'POST','rpc/submit_range_payment',base(dayA,0.01));
assert.notEqual(r.status,200,'Unlinked parent cannot submit another payment');checks++;
console.log(JSON.stringify({result:'PASS',syntheticJWT:3,assertions:checks,
 qaHistoricalConfirmedExcluded:true,qaPendingExcluded:true,
 real400Confirmed:true,real1000Confirmed:true,unmarkOverpayBlocked:true,
 sameJwtUnlinkRevoked:true,productionWrites:0}));
