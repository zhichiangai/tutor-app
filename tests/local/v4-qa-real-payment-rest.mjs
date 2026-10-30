// CI-only real local GoTrue JWT test of mixed QA and genuine payment allocations.
// Run ONLY after three QA candidates and v4_qa_real_payment_rpc_reconciliation candidate.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.V4_QA_REAL_PAYMENT_TEST,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const db=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],{encoding:'utf8'}).trim();
let checks=0;
function eq(a,b,msg){assert.equal(a,b,msg);checks++}
const actors={};
for(const role of ['teacher','parent','otherParent','student']){
 const email='mixed-'+role+'-'+randomUUID()+'@local.invalid';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',
  headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password:randomBytes(22).toString('base64url')+'aA1'})});
 const body=await r.json();eq(r.status,200,role+' sign-up');
 assert.ok(body.access_token);checks++;
 actors[role]={id:body.user.id,jwt:body.access_token,email};
}
const t=actors.teacher,p=actors.parent;
const ids=Object.fromEntries(['student','invite','qaOnly','qaPart','legacyQA','legacyReal','wholeQA','qaFullBatch','qaPartBatch'].map(k=>[k,randomUUID()]));
const reason='Audited completely synthetic bank-transfer simulation';
db(`begin;
insert into public.workspaces(owner_id) values('${t.id}');
insert into public.students(id,teacher_id,name)
 values('${ids.student}','${t.id}','QA real reconciliation synthetic student');
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values('${ids.invite}','${t.id}','${ids.student}','${p.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values('${t.id}','${ids.student}','${p.id}','${ids.invite}');
insert into public.lesson_records
(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status)
values
('${ids.qaOnly}','${t.id}','${ids.student}','2026-09-01','lesson',2,500,1000,'老師已收到'),
('${ids.qaPart}','${t.id}','${ids.student}','2026-09-02','lesson',2,500,1000,'未付款'),
('${ids.legacyQA}','${t.id}','${ids.student}','2026-09-03','lesson',2,500,1000,'老師已收到'),
('${ids.legacyReal}','${t.id}','${ids.student}','2026-09-04','lesson',2,500,1000,'老師已收到'),
('${ids.wholeQA}','${t.id}','${ids.student}','2026-09-05','lesson',2,500,1000,'未付款');
insert into public.payment_batches
(id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
values
('${ids.qaFullBatch}','${t.id}','${ids.student}','${p.id}','2026-09-01','2026-09-01','2026-09-01',1000,'confirmed','2026-09-01',now()),
('${ids.qaPartBatch}','${t.id}','${ids.student}','${p.id}','2026-09-02','2026-09-02','2026-09-02',400,'confirmed','2026-09-02',now());
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values
('${ids.qaFullBatch}','${ids.qaOnly}',1000),
('${ids.qaPartBatch}','${ids.qaPart}',400);
commit;`);
async function req(actor,rpc,body){
 const r=await fetch(s.API_URL+'/rest/v1/rpc/'+rpc,{method:'POST',
  headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+(actor?.jwt||s.ANON_KEY),
   'Content-Type':'application/json'},body:JSON.stringify(body)});
 const raw=await r.text();
 let obj;try{obj=raw?JSON.parse(raw):null}catch{obj=raw}
 checks++;return{status:r.status,body:obj};
}
// QA classification is audited and requires a real teacher JWT.
async function mark(table,values){
 const r=await fetch(s.API_URL+'/rest/v1/'+table,{method:'POST',
  headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+t.jwt,
   'Content-Type':'application/json',Prefer:'return=representation'},
  body:JSON.stringify(values)});
 const response=await r.text();eq(r.status,201,'QA mark rejected: '+response.slice(0,350));
}
for(const id of [ids.qaFullBatch,ids.qaPartBatch])
 await mark('v4_payment_batch_qa_marks',{batch_id:id,is_qa:true,reason,classified_by:t.id});
await mark('v4_lesson_qa_marks',{
 lesson_id:ids.legacyQA,classification:'simulated_legacy_receipt',
 is_qa:true,reason,classified_by:t.id});
await mark('v4_lesson_qa_marks',{
 lesson_id:ids.wholeQA,classification:'simulated_lesson',
 is_qa:true,reason,classified_by:t.id});
const base=id=>({p_teacher_id:t.id,p_student_id:ids.student,
 p_period_start:id,p_period_end:id,p_paid_on:'2026-09-20',p_paid_amount:600,
 p_note:'Synthetic QA distinction verification'});
// Actual lesson date corresponding to id; map to the exact 1-day date range.
function on(day,amount=600){return{...base(),p_period_start:day,p_period_end:day,p_paid_amount:amount};}
const goodDate={...on('2026-09-01'),p_paid_amount:600};
for(const actor of [null,actors.student,actors.otherParent]){
 const r=await req(actor,'submit_range_payment',goodDate);
 assert.notEqual(r.status,200,'Unauthorized parent must never pay');checks++;
}
let r=await req(p,'submit_range_payment',goodDate);
eq(r.status,200,'Real payment after QA-only previously received lesson: '+JSON.stringify(r.body));
const one=r.body;assert.match(one,/^[0-9a-f-]{36}$/i);checks++;
eq(db(`select sum(i.allocated_amount)::numeric(12,2)
from public.payment_batch_items i where i.batch_id='${one}'`),'600.00');
eq(db(`select count(*) from tutor_private.v4_qa_receipt_reconciliation_authorizations`),'0');
r=await req(p,'submit_range_payment',on('2026-09-01',500));
eq(r.status,400,'Pending 600 leaves 400, so 500 must be rejected');
eq(db(`select count(*) from public.payment_batch_items where lesson_id='${ids.qaOnly}' and batch_id<>'${ids.qaFullBatch}'`),'1');
r=await req(t,'review_range_payment',{p_batch_id:one,p_confirm:true,p_received_on:'2026-09-20'});
eq(r.status,204,'Teacher must confirm genuine 600 after simulated full receipt: '+JSON.stringify(r.body));
eq(db(`select status from public.lesson_records where id='${ids.qaOnly}'`),'未付款');
eq(db(`select applied from tutor_private.v4_qa_receipt_reconciliation_authorizations
where batch_id='${one}'`),'t','Private audit token must be consumed once');
r=await req(p,'submit_range_payment',on('2026-09-01',400));
eq(r.status,200,'Remaining 400 after QA-only receipt');
const two=r.body;
r=await req(t,'review_range_payment',{p_batch_id:two,p_confirm:true,p_received_on:'2026-09-20'});
eq(r.status,204,'Teacher confirmed full genuine 1000');
eq(db(`select status from public.lesson_records where id='${ids.qaOnly}'`),'老師已收到');
eq(db(`select coalesce(sum(i.allocated_amount),0)::numeric(12,2)
 from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
 left join public.v4_payment_batch_qa_marks qm on qm.batch_id=b.id
 where i.lesson_id='${ids.qaOnly}' and b.status='confirmed'
 and coalesce(qm.is_qa,false)=false`),'1000.00');
r=await req(p,'submit_range_payment',on('2026-09-02',1000));
eq(r.status,200,'QA 400 on ordinary lesson must not block 1000 real');
const three=r.body;
r=await req(t,'review_range_payment',{p_batch_id:three,p_confirm:true,p_received_on:'2026-09-20'});
eq(r.status,204,'Teacher confirms mixed QA400 and real1000');
eq(db(`select status from public.lesson_records where id='${ids.qaPart}'`),'老師已收到');
r=await req(p,'submit_range_payment',on('2026-09-03',600));
eq(r.status,200,'Explicit legacy QA receipt may be reconciled');
const four=r.body;
r=await req(t,'review_range_payment',{p_batch_id:four,p_confirm:true,p_received_on:'2026-09-20'});
eq(r.status,204,'Teacher confirms after explicit legacy QA receipt');
eq(db(`select status from public.lesson_records where id='${ids.legacyQA}'`),'未付款');
for(const day of ['2026-09-04','2026-09-05']){
 const result=await req(p,'submit_range_payment',on(day,600));
 assert.notEqual(result.status,200,'Real legacy or whole QA lesson cannot accept new real payment');
 checks++;
}
// Teacher alone may not directly perform a status reversal without a private one-use token.
const attempt=await fetch(s.API_URL+'/rest/v1/lesson_records?id=eq.'+ids.qaOnly,{
 method:'PATCH',headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+t.jwt,
 'Content-Type':'application/json','Prefer':'return=representation'},
 body:JSON.stringify({status:'未付款',received_date:null})});
assert.notEqual(attempt.status,200,'Teacher manual paid-status reversal must be denied');checks++;
eq(db(`select count(*) from public.payment_batches b
left join public.v4_payment_batch_qa_marks qm on qm.batch_id=b.id
where b.parent_id='${p.id}' and b.status='confirmed'
  and coalesce(qm.is_qa,false)=false`),'4');
// A still-valid parent JWT and previously known UUID must not bypass unlink RLS.
db(`delete from public.student_guardians
where guardian_id='${p.id}' and student_id='${ids.student}'`);
async function readOldId(actor,resource){
 const r=await fetch(s.API_URL+'/rest/v1/'+resource,{method:'GET',
  headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+actor.jwt}});
 const raw=await r.text();let body;
 try{body=JSON.parse(raw)}catch{body=null}
 checks++;return{status:r.status,body};
}
for(const resource of [
 'payment_batches?id=eq.'+one+'&select=id',
 'payment_batch_items?batch_id=eq.'+one+'&select=batch_id',
 'lesson_records?id=eq.'+ids.qaOnly+'&select=id'
]){
 const stale=await readOldId(p,resource);
 if(stale.status===200)eq(stale.body.length,0,
  'Unlinked guardian retained read access to old protected ID: '+resource.split('?')[0]);
 else{assert.ok([401,403].includes(stale.status),'Unexpected unlink RLS response '+stale.status);checks++;}
}
const teacherKeeps=await readOldId(t,'payment_batches?id=eq.'+one+'&select=id');
eq(teacherKeeps.status,200,'Teacher historical accounting must remain readable');
eq(teacherKeeps.body.length,1,'Owning teacher retains genuine payment history');
console.log(JSON.stringify({result:'PASS',assertions:checks,realLocalJWT:4,
 genuineOnQaHistory:600,realConfirmedTotal:1000,qaExcluded:true,
 legacyReceiptControlled:true,productionWrites:0}));
