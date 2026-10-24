// Opt-in localhost-only integration; creates synthetic GoTrue users and rows.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert.equal(process.env.V40_LOCAL_CORRECTION_TEST,'1');
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
assert.match(status.DB_URL,/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:54322\/postgres$/);
const container='supabase_db_tutor_v4_isolated';
const sql=s=>execFileSync('docker',['exec',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',s],{encoding:'utf8'}).trim();
let checks=0;
const equal=(actual,expected,message)=>{assert.equal(actual,expected,message);checks++};
const actors={};
for(const label of ['teacher','otherTeacher','parent','otherParent','student']){
 const email=`v40-${label}-${randomUUID()}@local.invalid`;
 const response=await fetch(status.API_URL+'/auth/v1/signup',{method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:randomBytes(24).toString('base64url')+'aA1'})});
 const data=await response.json();equal(response.status,200,label+' signup');assert.ok(data.access_token);checks++;
 actors[label]={id:data.user.id,email,jwt:data.access_token};
}
const ids=Object.fromEntries(['student','invite','l1','l2'].map(k=>[k,randomUUID()]));
const a=actors,f=ids;
sql(`begin;
insert into public.workspaces(owner_id) values('${a.teacher.id}');
insert into public.students(id,teacher_id,name) values('${f.student}','${a.teacher.id}','Synthetic accounting');
insert into public.guardian_invites(id,teacher_id,student_id,email) values('${f.invite}','${a.teacher.id}','${f.student}','${a.parent.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id) values('${a.teacher.id}','${f.student}','${a.parent.id}','${f.invite}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status) values
('${f.l1}','${a.teacher.id}','${f.student}','2026-09-01','lesson',2,500,1000,'未付款'),
('${f.l2}','${a.teacher.id}','${f.student}','2026-09-02','lesson',2,500,1000,'未付款');
commit;`);
async function rpc(who,name,body){
 const token=who?actors[who].jwt:status.ANON_KEY;
 const response=await fetch(status.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const text=await response.text();
 return {code:response.status,data:text?JSON.parse(text):null};
}
async function rows(who,path){
 const r=await fetch(status.API_URL+'/rest/v1/'+path,{headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+actors[who].jwt}});
 equal(r.status,200,who+' '+path);return r.json();
}
const submit={p_teacher_id:a.teacher.id,p_student_id:f.student,p_period_start:'2026-09-01',p_period_end:'2026-09-02',p_paid_on:'2026-09-03',p_paid_amount:1500,p_note:'synthetic'};
let result=await rpc('parent','submit_range_payment',submit);equal(result.code,200,JSON.stringify(result.data));
const batch=result.data;
equal((await rows('parent',`payment_batch_items?select=allocated_amount,lesson_id&batch_id=eq.${batch}&order=lesson_id`)).length,2);
result=await rpc('teacher','review_range_payment',{p_batch_id:batch,p_confirm:true,p_received_on:'2026-09-03'});
equal(result.code,204,JSON.stringify(result.data));
const reason='銀行對帳確認部分款項需要退回';
const key1=randomUUID(),key2=randomUUID();
const c1={p_batch_id:batch,p_idempotency_key:key1,p_reason:reason,p_lines:[{lesson_id:f.l1,amount:'250.00'}]};
for(const who of [null,'parent','student','otherTeacher']){
 result=await rpc(who,'v4_apply_payment_correction',c1);
 assert.notEqual(result.code,200,`${who} unauthorized correction`);checks++;
}
result=await rpc('teacher','v4_apply_payment_correction',c1);equal(result.code,200,JSON.stringify(result.data));
equal(result.data.amount,250);equal(result.data.replayed,false);
result=await rpc('teacher','v4_apply_payment_correction',c1);equal(result.code,200);equal(result.data.replayed,true);
result=await rpc('teacher','v4_apply_payment_correction',{...c1,p_lines:[{lesson_id:f.l1,amount:'200.00'}]});
assert.notEqual(result.code,200);checks++;
result=await rpc('teacher','v4_apply_payment_correction',{...c1,p_idempotency_key:key2,p_lines:[{lesson_id:f.l2,amount:'500.00'}]});
equal(result.code,200,JSON.stringify(result.data));
let preview=await rpc('teacher','v4_payment_correction_preview',{p_batch_id:batch});equal(preview.code,200);
equal(preview.data.original,1500);equal(preview.data.remaining,750);
const line=new Map(preview.data.lines.map(x=>[x.lesson_id,x]));
equal(line.get(f.l1).net,750);equal(line.get(f.l2).net,0);
const lessons=await rows('teacher',`lesson_records?select=id,status,received_date&id=in.(${f.l1},${f.l2})`);
equal(lessons.filter(l=>l.status==='未付款').length,2);
result=await rpc('parent','submit_range_payment',{...submit,p_paid_amount:500});equal(result.code,200,JSON.stringify(result.data));
const secondBatch=result.data;
result=await rpc('teacher','review_range_payment',{p_batch_id:secondBatch,p_confirm:true,p_received_on:'2026-09-04'});equal(result.code,204,JSON.stringify(result.data));
const afterRepay=await rows('teacher',`lesson_records?select=id,status&id=in.(${f.l1},${f.l2})`);
equal(afterRepay.find(l=>l.id===f.l1).status,'老師已收到');
equal(afterRepay.find(l=>l.id===f.l2).status,'未付款');
for(const [lines,why] of [
 [[{lesson_id:f.l1,amount:'1000.01'}],reason],
 [[{lesson_id:f.l1,amount:'-1'}],reason],
 [[{lesson_id:f.l1,amount:'1.001'}],reason],
 [[{lesson_id:f.l1,amount:'1.00'}],'短']
]){
 const rejection=await rpc('teacher','v4_apply_payment_correction',{p_batch_id:batch,p_idempotency_key:randomUUID(),p_reason:why,p_lines:lines});
 assert.notEqual(rejection.code,200,JSON.stringify(rejection.data));checks++;
}
const concurrent=[...Array(2)].map(()=>rpc('teacher','v4_apply_payment_correction',{
 p_batch_id:batch,p_idempotency_key:randomUUID(),p_reason:reason,p_lines:[{lesson_id:f.l1,amount:'750.00'}]}));
const raced=await Promise.all(concurrent);
equal(raced.filter(x=>x.code===200).length,1,'only one concurrent request can consume remaining allocation');
equal((await rows('teacher',`lesson_records?select=status&id=eq.${f.l1}`))[0].status,'未付款');
const correctionRows=await rows('parent',`payment_batch_corrections?select=id,amount&batch_id=eq.${batch}`);equal(correctionRows.length,3);
for(const [method,path,body] of [
 ['PATCH',`payment_batch_corrections?id=eq.${correctionRows[0].id}`,{amount:1}],
 ['DELETE',`payment_batch_correction_items?correction_id=eq.${correctionRows[0].id}`,null]
]){
 const r=await fetch(status.API_URL+'/rest/v1/'+path,{method,headers:{apikey:status.ANON_KEY,
  Authorization:'Bearer '+a.teacher.jwt,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.notEqual(r.status,204,'immutable audit cannot be edited by browser role');checks++;
}
equal((await rows('student',`payment_batch_corrections?select=id&batch_id=eq.${batch}`)).length,0);
equal((await rows('otherParent',`payment_batch_corrections?select=id&batch_id=eq.${batch}`)).length,0);
sql(`delete from public.student_guardians where student_id='${f.student}' and guardian_id='${a.parent.id}'`);
equal((await rows('parent',`payment_batch_corrections?select=id&id=eq.${correctionRows[0].id}`)).length,0);
equal((await rows('parent',`payment_batch_correction_items?select=correction_id&correction_id=eq.${correctionRows[0].id}`)).length,0);
equal((await rows('teacher',`payment_batch_corrections?select=id&batch_id=eq.${batch}`)).length,3);
console.log(JSON.stringify({result:'PASS',localAuth:5,assertions:checks,original:1500,corrected:750,net:750,productionWrites:0}));
