// Opt-in localhost integration test against the fully replayed V4 schema.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

assert.equal(process.env.V40_LOCAL_METADATA_TEST,'1');
const root=new URL('../../',import.meta.url).pathname;
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
function db(query){return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',query],{encoding:'utf8'}).trim()}
assert.equal(db("select count(*) from information_schema.columns where table_schema='public' and ((table_name='students' and column_name='is_qa') or (table_name='lesson_records' and column_name='time_accuracy'))"),'2');
async function signup(label){
 const email=`v40-${label}-${randomUUID()}@local.invalid`,password=randomBytes(24).toString('base64url')+'aA1';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 const j=await r.json();assert.equal(r.status,200,j.message);return {id:j.user.id,email,jwt:j.access_token};
}
const teacher=await signup('teacher'),parent=await signup('parent');
const student=randomUUID(),invite=randomUUID(),lesson=randomUUID();
db(`begin;
insert into public.workspaces(owner_id) values ('${teacher.id}');
insert into public.students(id,teacher_id,name) values ('${student}','${teacher.id}','Synthetic student');
insert into public.guardian_invites(id,teacher_id,student_id,email) values ('${invite}','${teacher.id}','${student}','${parent.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id) values ('${teacher.id}','${student}','${parent.id}','${invite}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,start_time,end_time,hours,hourly_rate,total_amount,status,received_date)
 values ('${lesson}','${teacher.id}','${student}','2026-09-15','lesson','17:00','19:00',2,500,1000,'老師已收到','2026-09-16');
commit;`);
let assertions=0;
async function api(actor,method,table,query,body){
 const r=await fetch(s.API_URL+'/rest/v1/'+table+'?'+query,{method,headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+actor.jwt,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{})});
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));assertions++;return j;
}
assert.equal((await api(parent,'PATCH','students',`id=eq.${student}`,{is_qa:true})).length,0);assertions++;
assert.equal((await api(teacher,'PATCH','students',`id=eq.${student}`,{is_qa:true})).length,1);assertions++;
assert.equal((await api(parent,'GET','students',`select=is_qa&id=eq.${student}`))[0].is_qa,true);assertions++;
assert.equal(db(`select count(*) from tutor_private.qa_student_mark_audit where student_id='${student}' and actor_id='${teacher.id}' and previous_is_qa=false and new_is_qa=true`),'1');assertions++;
assert.equal((await api(parent,'PATCH','lesson_records',`id=eq.${lesson}`,{time_accuracy:'estimated'})).length,0);assertions++;
assert.equal((await api(teacher,'PATCH','lesson_records',`id=eq.${lesson}`,{time_accuracy:'estimated'})).length,1);assertions++;
const row=(await api(parent,'GET','lesson_records',`select=time_accuracy,hours,total_amount,status&id=eq.${lesson}`))[0];
assert.deepEqual(row,{time_accuracy:'estimated',hours:2,total_amount:1000,status:'老師已收到'});assertions++;
// Force the local notification outbox insert to fail. The V4 enqueue hook
// catches that failure; the new guardian relation must still exist in the
// transaction. Roll back the temporary constraint and synthetic relation.
const extraStudent=randomUUID(),extraInvite=randomUUID();
db(`begin;
alter table tutor_private.v4_email_outbox add constraint local_fail_enqueue check(false) not valid;
insert into public.students(id,teacher_id,name) values ('${extraStudent}','${teacher.id}','Notification failure fixture');
insert into public.guardian_invites(id,teacher_id,student_id,email) values ('${extraInvite}','${teacher.id}','${extraStudent}','${parent.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id) values ('${teacher.id}','${extraStudent}','${parent.id}','${extraInvite}');
do $check$ begin
 if not exists(select 1 from public.student_guardians where student_id='${extraStudent}' and guardian_id='${parent.id}')
 then raise exception 'Notification enqueue failure rolled back a legal link'; end if;
end $check$;
rollback;`);
assertions++;
console.log(JSON.stringify({result:'PASS',realLocalJWT:2,assertions,productionWrites:0}));
