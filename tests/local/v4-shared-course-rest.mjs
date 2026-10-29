// Real GoTrue + REST synthetic three-role shared course CRUD on disposable localhost.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.V4_SHARED_COURSE_LOCAL_TEST,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const db=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated',
 'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],
 {encoding:'utf8'}).trim();
const taipeiDay=instant=>{
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',
 year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant).map(x=>[x.type,x.value]));
 return [p.year,p.month,p.day].join('-');
};
const futureDay=n=>taipeiDay(new Date(Date.now()+n*86400000));
const day=futureDay(10),changed=futureDay(11),wk=futureDay(15),bi=futureDay(16),end=futureDay(60);
const weekDay=d=>((new Date(d+'T00:00:00Z').getUTCDay()+6)%7)+1;
let checks=0;
const eq=(a,b,m)=>{assert.equal(a,b,m);checks++};
const u={};
for(const role of ['teacher','parent','student','unlinked']){
 const email='crud-'+role+'-'+randomUUID()+'@local.invalid';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',
  headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password:randomBytes(24).toString('base64url')+'aA1'})});
 const value=await r.json();eq(r.status,200,role+' signup');
 assert.ok(value.access_token);checks++;
 u[role]={id:value.user.id,jwt:value.access_token,email};
}
const ids=Object.fromEntries(['student','invite','studentInvite','studentLink'].map(v=>[v,randomUUID()]));
db(`begin;
insert into public.workspaces(owner_id) values('${u.teacher.id}');
insert into public.students(id,teacher_id,name,subject,hourly_rate)
 values('${ids.student}','${u.teacher.id}','Synthetic Shared Course','數學',500);
insert into public.guardian_invites(id,teacher_id,student_id,email)
 values('${ids.invite}','${u.teacher.id}','${ids.student}','${u.parent.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id)
 values('${u.teacher.id}','${ids.student}','${u.parent.id}','${ids.invite}');
insert into public.student_invitations(id,teacher_id,student_id,email)
 values('${ids.studentInvite}','${u.teacher.id}','${ids.student}','${u.student.email}');
insert into public.student_links(id,teacher_id,student_id,user_id,invitation_id)
 values('${ids.studentLink}','${u.teacher.id}','${ids.student}','${u.student.id}','${ids.studentInvite}');
commit;`);
async function request(actor,action,studentId=ids.student,target=null,payload={}){
 const r=await fetch(s.API_URL+'/rest/v1/rpc/shared_course_action',{method:'POST',
  headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+(actor?.jwt||s.ANON_KEY),
   'Content-Type':'application/json'},
  body:JSON.stringify({p_action:action,p_student_id:studentId,p_target_id:target,p_payload:payload})});
 const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null}catch{data=raw}
 checks++;return {status:r.status,data};
}
const fields=(date,sub='CI shared math',start='17:00',finish='18:00')=>({
 lesson_date:date,subject:sub,start_time:start,end_time:finish
});
let r=await request(u.unlinked,'create_lesson',ids.student,null,fields(day));
assert.notEqual(r.status,200,'unlinked identity cannot create student lessons');checks++;
r=await request(null,'create_lesson',ids.student,null,fields(day));
assert.notEqual(r.status,200,'anonymous cannot create student lessons');checks++;
r=await request(u.parent,'create_lesson',ids.student,null,fields(day));
eq(r.status,200,'Linked parent can schedule a new planned lesson: '+JSON.stringify(r.data));
const lesson=r.data.id;assert.match(lesson,/^[0-9a-f-]{36}$/i);checks++;
eq(db(`select type from public.lesson_records where id='${lesson}'`),'planned');
const version1=db(`select updated_at::text from public.lesson_records where id='${lesson}'`);
r=await request(u.student,'update_lesson',ids.student,lesson,{
 ...fields(changed,'CI shared lesson edited','18:00','19:00'),expected_updated_at:version1});
eq(r.status,200,'Linked student can edit planned lesson: '+JSON.stringify(r.data));
eq(db(`select lesson_date::text from public.lesson_records where id='${lesson}'`),changed);
eq(db(`select subject from public.lesson_records where id='${lesson}'`),'CI shared lesson edited');
r=await request(u.teacher,'update_lesson',ids.student,lesson,{
 ...fields(changed),expected_updated_at:version1});
assert.notEqual(r.status,200,'stale-version edit rejected');checks++;
const version2=db(`select updated_at::text from public.lesson_records where id='${lesson}'`);
r=await request(u.parent,'cancel_lesson',ids.student,lesson,{expected_updated_at:version2});
eq(r.status,200,'Linked guardian cancels a single planned lesson');
eq(db(`select type from public.lesson_records where id='${lesson}'`),'leave');
eq(db(`select total_amount::numeric(12,2) from public.lesson_records where id='${lesson}'`),'0.00');
const schedule=(startDate,frequency,hour)=>({
 starts_on:startDate,ends_on:end,weekdays:[weekDay(startDate)],every_weeks:frequency,
 subject:frequency===1?'CI weekly':'CI biweekly',
 start_time:hour,end_time:hour==='09:00'?'10:00':'13:00'
});
r=await request(u.student,'create_schedule',ids.student,null,schedule(wk,1,'09:00'));
eq(r.status,200,'Student can create weekly schedule: '+JSON.stringify(r.data));
const weekly=r.data.id;assert.match(weekly,/^[0-9a-f-]{36}$/i);checks++;
const scheduleV1=db(`select updated_at::text from public.recurring_schedules where id='${weekly}'`);
r=await request(u.parent,'cancel_schedule',ids.student,weekly,{
 from_date:futureDay(18),expected_updated_at:scheduleV1});
eq(r.status,200,'Guardian can stop future weekly lessons');
eq(db(`select cancelled_from is not null from public.recurring_schedules where id='${weekly}'`),'t');
r=await request(u.parent,'create_schedule',ids.student,null,schedule(bi,2,'12:00'));
eq(r.status,200,'Guardian can create biweekly schedule: '+JSON.stringify(r.data));
const biweekly=r.data.id;assert.match(biweekly,/^[0-9a-f-]{36}$/i);checks++;
const scheduleV2=db(`select updated_at::text from public.recurring_schedules where id='${biweekly}'`);
r=await request(u.student,'cancel_occurrence',ids.student,biweekly,{
 original_date:bi,expected_updated_at:scheduleV2});
eq(r.status,200,'Linked student cancels only one biweekly occurrence: '+JSON.stringify(r.data));
eq(db(`select count(*) from public.schedule_exceptions where schedule_id='${biweekly}'
 and original_date='${bi}' and action in ('student_leave','teacher_leave')`),'1');
eq(db(`select cancelled_from is null from public.recurring_schedules where id='${biweekly}'`),'t');
eq(db(`select count(*) from tutor_private.shared_course_events
 where student_id='${ids.student}' and action in (
 'create_lesson','update_lesson','cancel_lesson','create_schedule','cancel_schedule','cancel_occurrence')`),'6');
db(`delete from public.student_guardians where student_id='${ids.student}'
 and guardian_id='${u.parent.id}'`);
r=await request(u.parent,'create_lesson',ids.student,null,fields(futureDay(20),'After unlink'));
assert.notEqual(r.status,200,'Existing guardian JWT revoked after unlink');checks++;
r=await request(u.student,'create_lesson',ids.student,null,fields(futureDay(21),'Still linked'));
eq(r.status,200,'Student link survives guardian unlink');
console.log(JSON.stringify({result:'PASS',authRoles:4,assertions:checks,
 singleLessonCRUD:true,weeklyBiweekly:true,oneOccurrenceCancellation:true,
 staleVersionRejected:true,guardianUnlinkRevoked:true,productionWrites:0}));
