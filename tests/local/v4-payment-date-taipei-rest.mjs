// Opt-in localhost-only real GoTrue/PostgREST E2E for Asia/Taipei payment dates.
// This test never connects to hosted Supabase, runs only against a disposable
// local DB with all V4 migrations (including 20261029024000) replayed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

assert.equal(process.env.V4_PAYMENT_TAIPEI_LOCAL_TEST,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(status.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const db=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],
 {encoding:'utf8'}).trim();
const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
 year:'numeric',month:'2-digit',day:'2-digit'});
const dateAt=instant=>{
 const p=Object.fromEntries(fmt.formatToParts(instant).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
const today=dateAt(new Date());
const tomorrow=dateAt(new Date(Date.now()+86400_000));
const yesterday=dateAt(new Date(Date.now()-86400_000));
assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
assert.ok(tomorrow>today && yesterday<today);
let checks=0;
const equal=(actual,expected,message)=>{assert.equal(actual,expected,message);checks++};
const users={};
for(const type of ['teacher','parent']){
 const email=`date-${type}-${randomUUID()}@local.invalid`;
 const r=await fetch(status.API_URL+'/auth/v1/signup',{
  method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password:randomBytes(24).toString('base64url')+'aA1'})
 });
 const payload=await r.json();equal(r.status,200,JSON.stringify(payload));
 assert.ok(payload.access_token);checks++;
 users[type]={id:payload.user.id,email,jwt:payload.access_token};
}
const teacher=users.teacher,parent=users.parent;
const id=Object.fromEntries(['student','invite','lesson'].map(k=>[k,randomUUID()]));
db(`begin;
 insert into public.workspaces(owner_id) values('${teacher.id}');
 insert into public.students(id,teacher_id,name)
  values('${id.student}','${teacher.id}','Synthetic Taipei date boundary');
 insert into public.guardian_invites(id,teacher_id,student_id,email)
  values('${id.invite}','${teacher.id}','${id.student}','${parent.email}');
 insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
  values('${teacher.id}','${id.student}','${parent.id}','${id.invite}');
 insert into public.lesson_records
  (id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status)
  values ('${id.lesson}','${teacher.id}','${id.student}','${today}','lesson',2,500,1000,'未付款');
 commit;`);

async function rpc(user,name,data){
 const r=await fetch(status.API_URL+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+user.jwt,
   'Content-Type':'application/json'},body:JSON.stringify(data)
 });
 const raw=await r.text();let value;
 try{value=raw?JSON.parse(raw):null}catch{value=raw}
 checks++;
 return {status:r.status,data:value};
}
const base={
 p_teacher_id:teacher.id,p_student_id:id.student,
 p_period_start:today,p_period_end:today,
 p_paid_on:today,p_paid_amount:600,p_note:'Synthetic Taipei business date'
};
let r=await rpc(parent,'submit_range_payment',base);
equal(r.status,200,'Taipei today must be accepted even with UTC database session: '+JSON.stringify(r.data));
const first=r.data;
assert.match(first,/^[a-f0-9-]{36}$/i);checks++;
equal(db(`select count(*) from public.payment_batches where id='${first}' and parent_id='${parent.id}'`),'1');
equal(db(`select coalesce(sum(allocated_amount),0)::numeric(12,2)
 from public.payment_batch_items where batch_id='${first}'`),'600.00');
r=await rpc(parent,'submit_range_payment',{...base,p_paid_on:tomorrow,p_paid_amount:400});
assert.notEqual(r.status,200,'Taipei tomorrow must be rejected');checks++;
assert.match(JSON.stringify(r.data),/Payment date cannot be in the future/);checks++;
equal(db(`select count(*) from public.payment_batches where parent_id='${parent.id}'`),'1');

r=await rpc(teacher,'review_range_payment',{
 p_batch_id:first,p_confirm:true,p_received_on:tomorrow
});
assert.notEqual(r.status,204,'Teacher must not confirm future Taipei receipt');checks++;
assert.match(JSON.stringify(r.data),/Actual receipt date is required/);checks++;
equal(db(`select status from public.payment_batches where id='${first}'`),'pending');

r=await rpc(teacher,'review_range_payment',{p_batch_id:first,p_confirm:true,p_received_on:today});
equal(r.status,204,'Teacher must be able to confirm Taipei today: '+JSON.stringify(r.data));
equal(db(`select status from public.payment_batches where id='${first}'`),'confirmed');
equal(db(`select coalesce(sum(i.allocated_amount),0)::numeric(12,2)
 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
 where i.lesson_id='${id.lesson}' and b.status='confirmed'`),'600.00');

r=await rpc(parent,'submit_range_payment',{...base,p_paid_amount:400});
equal(r.status,200,'Remaining partial payment should work with same Taipei date: '+JSON.stringify(r.data));
const second=r.data;
assert.notEqual(second,first);checks++;
equal(db(`select count(*) from public.payment_batches where parent_id='${parent.id}'`),'2');
equal(db(`select sum(allocated_amount)::numeric(12,2) from public.payment_batch_items
 where batch_id='${second}'`),'400.00');
r=await rpc(parent,'submit_range_payment',{...base,p_paid_amount:400});
assert.notEqual(r.status,200,'Do not allow repeated amount beyond lesson balance');checks++;
equal(db(`select count(*) from public.payment_batches where parent_id='${parent.id}'`),'2');
console.log(JSON.stringify({result:'PASS',realLocalJWT:2,assertions:checks,
 testingDate:today,timeZone:'Asia/Taipei',futureRejected:true,
 amountFirst:600,amountSecond:400,productionWrites:0}));
