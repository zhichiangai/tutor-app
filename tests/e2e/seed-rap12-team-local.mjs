// RAP-12 disposable-local Team GUI fixture. Never targets hosted Supabase.
// Requires an already running, UNLINKED Supabase local stack.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const fixturePath=process.env.RAP12_FIXTURE_FILE;
assert.equal(process.env.V4_E2E_LOCAL,'1','Disposable-local guard required');
assert.equal(process.env.RAP12_TEAM_GUI_LOCAL,'1','Explicit RAP-12 guard required');
assert.ok(fixturePath&&isAbsolute(fixturePath)&&fixturePath.endsWith('.json'),
 'Choose a fresh absolute .json fixture under the local OS temporary directory');
assert.equal(relative(resolve(tmpdir()),resolve(dirname(fixturePath))).startsWith('..'),false,
 'Credential fixture must stay inside the current OS temporary directory');
assert.equal(existsSync(fixturePath),false,'Do not overwrite an existing fixture');
const config=readFileSync(root+'supabase/config.toml','utf8');
assert.match(config,/^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(root+'supabase/.temp/project-ref'),false,
 'Refusing a checkout linked to any hosted Supabase project');
const local=JSON.parse(execFileSync('supabase',['status','-o','json'],{
 cwd:root,encoding:'utf8',timeout:20000
}));
assert.equal(local.API_URL,'http://127.0.0.1:54321');
assert.match(local.DB_URL,/^postgresql?:\/\/[^ ]+@127\.0\.0\.1:54322\/postgres$/);
assert.ok(local.ANON_KEY,'Local anonymous API key is missing');
// A developer laptop must not expose the disposable stack to its LAN.
// GitHub-hosted CI is already an ephemeral runner with no persistent user data.
if(process.env.CI!=='true'){
 const containers=execFileSync('docker',['ps','--filter','name=tutor_v4_isolated',
  '--format','{{.Names}}'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.ok(containers.includes('supabase_db_tutor_v4_isolated'),
  'Named disposable DB container is not running');
 for(const name of containers){
  const item=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}))[0];
  for(const bindings of Object.values(item.NetworkSettings.Ports||{})){
   for(const bind of bindings||[])assert.ok(['127.0.0.1','::1'].includes(bind.HostIp),
    'Unsafe LAN-exposed Docker port detected on '+name+
    '; configure Localhost only and RECREATE disposable containers before retrying');
  }
 }
}
function db(sql){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated',
  'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres',
  '-At','-c',sql],{encoding:'utf8',timeout:20000}).trim();
}
function uid(value){
 assert.match(value,/^[0-9a-f-]{36}$/i,'Invalid UUID');
 return value;
}
async function createActor(label){
 const email='rap12-'+label+'-'+randomUUID()+'@local.invalid';
 const password=randomBytes(30).toString('base64url')+'aA1';
 const response=await fetch(local.API_URL+'/auth/v1/signup',{
  method:'POST',headers:{apikey:local.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email,password})
 });
 assert.equal(response.status,200,'Local sign-up failed for '+label);
 const result=await response.json();
 assert.ok(result.access_token,'Local sign-up must provide disposable session');
 return {id:uid(result.user.id),email,password};
}
async function jwt(actor){
 const r=await fetch(local.API_URL+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:local.ANON_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({email:actor.email,password:actor.password})
 });
 assert.equal(r.status,200,'Local sign-in failed');
 const data=await r.json();
 return data.access_token;
}
async function api(token,method,path,body,expected=200){
 const res=await fetch(local.API_URL+'/rest/v1/'+path,{
  method,headers:{apikey:local.ANON_KEY,Authorization:'Bearer '+token,
   'content-type':'application/json',Prefer:'return=representation'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const data=await res.json().catch(()=>null);
 assert.equal(res.status,expected,'Unexpected local API status '+method+' '+path);
 return data;
}
async function forbid(token,method,path,body){
 const res=await fetch(local.API_URL+'/rest/v1/'+path,{
  method,headers:{apikey:local.ANON_KEY,Authorization:'Bearer '+token,
   'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 assert.ok([401,403,404].includes(res.status),
  'Expected hard denial of privileged local API '+path+'; got '+res.status);
}
const actors={
 managerA:await createActor('manager-a'),
 teacherA:await createActor('teacher-a'),
 unassignedA:await createActor('unassigned-a'),
 studentA1:await createActor('student-a1'),
 studentA2:await createActor('student-a2'),
 managerB:await createActor('manager-b'),
 teacherB:await createActor('teacher-b'),
 studentB:await createActor('student-b')
};
// Synthetic users only. Never use a Production login identity or service-role key.
for(const actor of [actors.managerA,actors.teacherA,actors.managerB]){
 // Preserve existing synthetic GUI actors' workspaces; new students and unassigned teachers get none.
 db("insert into public.workspaces(owner_id) values ('"+actor.id+"');");
}
db("insert into public.profiles(id,display_name,last_role,enabled_roles,roles_configured) values "+
 Object.entries(actors).map(([label,a])=>{
  // H intentionally starts as a teacher-mode account without a V4/Team link.
  // After accepting the verified invitation, the app must add student mode.
  const role=label==='studentB'?'teacher':label.startsWith('student')?'student':'teacher';
  return "('"+a.id+"','RAP12 "+label+
   "','"+role+"',array['"+role+"']::text[],true)";
 }).join(',')+
 " on conflict(id) do update set display_name=excluded.display_name,"+
 "last_role=excluded.last_role,enabled_roles=excluded.enabled_roles,"+
 "roles_configured=excluded.roles_configured;");
const wsA=uid(db("select id from public.workspaces where owner_id='"+actors.managerA.id+"'"));
const wsB=uid(db("select id from public.workspaces where owner_id='"+actors.managerB.id+"'"));
assert.notEqual(wsA,wsB);
for(const ws of [wsA,wsB]){
 db("select tutor_private.v5_admin_grant_entitlement('"+ws+
  "','team',0,'RAP12 isolated QA','Temporary local synthetic Team fixture');");
}
const teamA=uid(db("select id from public.v5_teams where anchor_workspace_id='"+wsA+"'"));
const teamB=uid(db("select id from public.v5_teams where anchor_workspace_id='"+wsB+"'"));
assert.notEqual(teamA,teamB);
const tA=await jwt(actors.managerA);
const tB=await jwt(actors.managerB);
const tMember=await jwt(actors.teacherA);
const tUnassigned=await jwt(actors.unassignedA);
const tTeacherB=await jwt(actors.teacherB);
const tStudentA1=await jwt(actors.studentA1);
const tStudentA2=await jwt(actors.studentA2);
const tStudentB=await jwt(actors.studentB);
async function project(token,workspace,creator,name){
 const d=await api(token,'POST','v5_team_projects?select=id',
  {workspace_id:workspace,created_by:creator,name},201);
 return uid(d[0].id);
}
const aShared=await project(tA,wsA,actors.managerA.id,'RAP12 Alpha Shared');
const aPrivate=await project(tA,wsA,actors.managerA.id,'RAP12 Alpha Manager Only');
const bPrivate=await project(tB,wsB,actors.managerB.id,'RAP12 Beta Foreign');
const invited=await api(tA,'POST','v5_team_invitations?select=id',
 {workspace_id:wsA,invited_by:actors.managerA.id,
  recipient_email:actors.teacherA.email.toLowerCase()},201);
await api(tMember,'POST','rpc/v5_accept_team_invitation',
 {p_invitation_id:uid(invited[0].id)},200);
// C is a legitimate Team A member without a project assignment.
const inviteC=await api(tA,'POST','v5_team_invitations?select=id',{
 workspace_id:wsA,invited_by:actors.managerA.id,
 recipient_email:actors.unassignedA.email.toLowerCase()
},201);
await api(tUnassigned,'POST','rpc/v5_accept_team_invitation',
 {p_invitation_id:uid(inviteC[0].id)},200);
// G belongs only to Team B; this is deliberately a different tenant.
const inviteG=await api(tB,'POST','v5_team_invitations?select=id',{
 workspace_id:wsB,invited_by:actors.managerB.id,
 recipient_email:actors.teacherB.email.toLowerCase()
},201);
await api(tTeacherB,'POST','rpc/v5_accept_team_invitation',
 {p_invitation_id:uid(inviteG[0].id)},200);
async function assign(token,workspace,projectId,userId){
 await api(token,'POST','v5_team_project_members?select=project_id',
  {workspace_id:workspace,project_id:projectId,user_id:userId},201);
}
await assign(tA,wsA,aShared,actors.managerA.id);
await assign(tA,wsA,aPrivate,actors.managerA.id);
await assign(tA,wsA,aShared,actors.teacherA.id);
await assign(tB,wsB,bPrivate,actors.managerB.id);
await assign(tB,wsB,bPrivate,actors.teacherB.id);
async function learner(token,teamId,projectId,creator,name){
 const s=await api(token,'POST','v5_team_students?select=id',
  {team_id:teamId,display_name:name,created_by:creator},201);
 const student=uid(s[0].id);
 await api(token,'POST','v5_team_enrollments?select=student_id',
  {team_id:teamId,project_id:projectId,student_id:student},201);
 return student;
}
const saShared=await learner(tA,teamA,aShared,actors.managerA.id,'RAP12 Alpha Student');
const saPrivate=await learner(tA,teamA,aPrivate,actors.managerA.id,'RAP12 Private Student');
const sbPrivate=await learner(tB,teamB,bPrivate,actors.managerB.id,'RAP12 Beta Student');
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
 timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'
}).formatToParts(new Date()).map(p=>[p.type,p.value]));
const month=parts.year+'-'+parts.month;
async function lesson(token,teamId,projectId,studentId,teacherId,subject,day){
 const d=await api(token,'POST','v5_team_lessons?select=id',{
  team_id:teamId,project_id:projectId,student_id:studentId,teacher_user_id:teacherId,
  subject,lesson_start:month+'-'+day+'T10:00:00+08:00',
  lesson_end:month+'-'+day+'T11:30:00+08:00',status:'completed',
  notes:'RAP12 synthetic local-only lesson'},201);
 return uid(d[0].id);
}
const la=await lesson(tA,teamA,aShared,saShared,actors.teacherA.id,'RAP12 Shared Math','15');
const lp=await lesson(tA,teamA,aPrivate,saPrivate,actors.managerA.id,'RAP12 Private Science','14');
const lb=await lesson(tB,teamB,bPrivate,sbPrivate,actors.managerB.id,'RAP12 Foreign English','13');
for(const [token,id] of [[tA,la],[tA,lp],[tB,lb]]){
 await api(token,'POST','rpc/v5_confirm_team_lesson_fee',
  {p_lesson_id:id,p_hourly_rate_cents:65000},200);
}
const teamIds=async token=>(await api(token,'GET','v5_teams?select=id')).map(x=>x.id);
assert.deepEqual((await teamIds(tA)).sort(),[teamA]);
assert.deepEqual((await teamIds(tMember)).sort(),[teamA]);
assert.deepEqual((await teamIds(tB)).sort(),[teamB]);
assert.deepEqual((await teamIds(tUnassigned)).sort(),[teamA]);
assert.deepEqual((await teamIds(tTeacherB)).sort(),[teamB]);
for(const token of [tStudentA1,tStudentA2,tStudentB])
 assert.deepEqual(await teamIds(token),[],'Unlinked student must not see Team identity');
const teacherProjects=await api(tMember,'GET','v5_team_projects?select=id');
assert.deepEqual(teacherProjects.map(p=>p.id).sort(),[aShared]);
async function visibleIds(token,table){
 const rows=await api(token,'GET',table+'?select=id');
 return rows.map(x=>x.id).sort();
}
assert.deepEqual(await visibleIds(tA,'v5_team_projects'),[aShared,aPrivate].sort());
assert.deepEqual(await visibleIds(tUnassigned,'v5_team_projects'),[]);
assert.deepEqual(await visibleIds(tTeacherB,'v5_team_projects'),[bPrivate]);
assert.deepEqual(await visibleIds(tB,'v5_team_projects'),[bPrivate]);
for(const token of [tStudentA1,tStudentA2,tStudentB])
 assert.deepEqual(await visibleIds(token,'v5_team_projects'),[],
  'Unlinked student must not see Team projects');
const teacherStudents=await api(tMember,'GET','v5_team_students?select=id');
assert.deepEqual(teacherStudents.map(s=>s.id).sort(),[saShared]);
assert.deepEqual(await visibleIds(tUnassigned,'v5_team_students'),[]);
assert.deepEqual(await visibleIds(tTeacherB,'v5_team_students'),[sbPrivate]);
for(const token of [tStudentA1,tStudentA2,tStudentB])
 assert.deepEqual(await visibleIds(token,'v5_team_students'),[],
  'Unlinked student must not see Team student records');
const teacherLessons=await api(tMember,'GET','v5_team_lessons?select=id');
assert.deepEqual(teacherLessons.map(x=>x.id).sort(),[la]);
assert.deepEqual(await visibleIds(tUnassigned,'v5_team_lessons'),[]);
assert.deepEqual(await visibleIds(tTeacherB,'v5_team_lessons'),[lb]);
assert.deepEqual(await visibleIds(tA,'v5_team_lessons'),[la,lp].sort());
assert.deepEqual(await visibleIds(tB,'v5_team_lessons'),[lb]);
for(const token of [tStudentA1,tStudentA2,tStudentB])
 assert.deepEqual(await visibleIds(token,'v5_team_lessons'),[],
  'Student Auth user has no Team learning authorization without a verified link');
// Check the privileged SECURITY DEFINER billing RPC with three real, distinct
// GoTrue JWTs. Cross-tenant managers must be denied even with a valid UUID.
const billingMonth=month+'-01';
await forbid(tMember,'POST','rpc/v5_team_billing_overview',
 {p_team_id:teamA,p_month:billingMonth});
await forbid(tA,'POST','rpc/v5_team_billing_overview',
 {p_team_id:teamB,p_month:billingMonth});
await forbid(tB,'POST','rpc/v5_team_billing_overview',
 {p_team_id:teamA,p_month:billingMonth});
await forbid(tMember,'GET','v5_team_lesson_fees?select=*');
for(const [token,target] of [[tUnassigned,teamA],[tTeacherB,teamB],
 [tStudentA1,teamA],[tStudentA2,teamA],[tStudentB,teamB]])
 await forbid(token,'POST','rpc/v5_team_billing_overview',
  {p_team_id:target,p_month:billingMonth});
// A second manager-only finance RPC must independently enforce access.
for(const [token,target] of [[tMember,teamA],[tUnassigned,teamA],
 [tTeacherB,teamB],[tStudentA1,teamA],[tStudentA2,teamA],
 [tStudentB,teamB],[tA,teamB],[tB,teamA]])
 await forbid(token,'POST','rpc/v5_team_payment_overview',
  {p_team_id:target,p_month:billingMonth});
const billing=await api(tA,'POST','rpc/v5_team_billing_overview',
 {p_team_id:teamA,p_month:billingMonth},200);
assert.ok(billing.confirmed_count>=2,'Synthetic manager billing must be populated');
const foreignManagerBilling=await api(tB,'POST','rpc/v5_team_billing_overview',
 {p_team_id:teamB,p_month:billingMonth},200);
assert.equal(foreignManagerBilling.confirmed_count,1,
 'Foreign Team manager can only review own synthetic lesson fee');
const managerPaymentA=await api(tA,'POST','rpc/v5_team_payment_overview',
 {p_team_id:teamA,p_month:billingMonth},200);
const managerPaymentB=await api(tB,'POST','rpc/v5_team_payment_overview',
 {p_team_id:teamB,p_month:billingMonth},200);
assert.equal(typeof managerPaymentA,'object');
assert.equal(typeof managerPaymentB,'object');
// Store credentials privately on the local machine only. Never print actor emails, passwords,
// API keys or IDs into CI logs, PRs, screenshots, or chatbot conversation.
const fixture={environment:'local',apiUrl:local.API_URL,baseUrl:'http://127.0.0.1:3000',
 anonKey:local.ANON_KEY,month,actors,ids:{teamA,teamB,wsA,wsB,aShared,aPrivate,bPrivate,
 saShared,saPrivate,sbPrivate,la,lp,lb}};
writeFileSync(fixturePath,JSON.stringify(fixture),{mode:0o600,flag:'wx'});
chmodSync(fixturePath,0o600);
console.log(JSON.stringify({result:'PASS',scope:'disposable-local',actors:8,
 teams:2,projects:3,lessons:3,managerOnlyFinancialRows:3,
 billingRpcCrossTeamDenied:2,billingRpcTeacherDenied:3,
 paymentRpcDenied:8,unassignedVisibleProjects:0,unlinkedStudentsDenied:3,
 teacherAccessibleProjects:1,foreignTenantAccess:0,productionWrites:0}));
