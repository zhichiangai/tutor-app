// CI-only synthetic fixture. Never connect to a hosted Supabase project.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.ok(process.env.V4_E2E_FIXTURE_FILE?.startsWith('/'));
const root=fileURLToPath(new URL('../../',import.meta.url));
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
assert.ok(s.ANON_KEY);
function db(q){return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],
 {encoding:'utf8'}).trim();}
const ids=Object.fromEntries(['student','qaStudent','invite','studentInvitation','studentLink','lesson','qaLesson'].map(k=>[k,randomUUID()]));
const actors={};
for(const label of ['teacher','parent','student','stranger']){
 const email='e2e-'+label+'-'+randomUUID()+'@local.invalid';
 const password=randomBytes(26).toString('base64url')+'aA1';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',
  headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password})});
 const data=await r.json();
 assert.equal(r.status,200,label+': '+(data.message||data.msg||r.status));
 assert.ok(data.access_token,label+' requires actual GoTrue session');
 actors[label]={id:data.user.id,email,password};
}
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
 timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const day=[parts.year,parts.month,parts.day].join('-');
const t=actors.teacher,p=actors.parent,student=actors.student;
db(`begin;
insert into public.workspaces(owner_id) values ('${t.id}');
insert into public.students(id,teacher_id,name,subject,hourly_rate,is_qa)
 values
 ('${ids.student}','${t.id}','CI Student','數學',500,false),
 ('${ids.qaStudent}','${t.id}','CI QA Student','英文',500,true);
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values ('${ids.invite}','${t.id}','${ids.student}','${p.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values ('${t.id}','${ids.student}','${p.id}','${ids.invite}');
insert into public.student_invitations(id,student_id,teacher_id,email)
 values ('${ids.studentInvitation}','${ids.student}','${t.id}','${student.email}');
insert into public.student_links(id,student_id,teacher_id,user_id,invitation_id)
 values ('${ids.studentLink}','${ids.student}','${t.id}','${student.id}','${ids.studentInvitation}');
insert into public.lesson_records
 (id,owner_id,student_id,lesson_date,type,start_time,end_time,hours,hourly_rate,total_amount,status)
 values
 ('${ids.lesson}','${t.id}','${ids.student}','${day}','lesson','17:00','19:00',2,500,1000,'未付款'),
 ('${ids.qaLesson}','${t.id}','${ids.qaStudent}','${day}','lesson','18:00','19:00',1,500,500,'未付款');
insert into public.profiles(id,display_name,last_role,enabled_roles,roles_configured)
 values
 ('${t.id}','CI Teacher','teacher',array['teacher']::text[],true),
 ('${p.id}','CI Parent','parent',array['parent']::text[],true),
 ('${student.id}','CI Learner','student',array['student']::text[],true),
 ('${actors.stranger.id}','CI Stranger','parent',array['parent']::text[],true)
 on conflict(id) do update set
 display_name=excluded.display_name,
 last_role=excluded.last_role,
 enabled_roles=excluded.enabled_roles,
 roles_configured=excluded.roles_configured;
commit;`);
const fixture={baseUrl:'http://127.0.0.1:3000',apiUrl:s.API_URL,
 anonKey:s.ANON_KEY, day,ids,actors};
writeFileSync(process.env.V4_E2E_FIXTURE_FILE,JSON.stringify(fixture),{mode:0o600});
chmodSync(process.env.V4_E2E_FIXTURE_FILE,0o600);
console.log(JSON.stringify({result:'PASS',syntheticActors:4,syntheticLessons:2,
 project:'tutor_v4_isolated',productionWrites:0}));
