// RAP-49 isolated Team Student end-to-end backend acceptance.
// Eight independent real GoTrue JWTs; never targets hosted Supabase.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,isAbsolute,relative,dirname} from 'node:path';
import {tmpdir} from 'node:os';

assert.equal(process.env.V4_E2E_LOCAL,'1','Disposable local environment required');
assert.equal(process.env.RAP12_TEAM_GUI_LOCAL,'1','Eight-account RAP12 fixture required');
assert.equal(process.env.RAP49_STUDENT_LOCAL,'1','RAP49 acceptance flag required');
const path=process.env.RAP12_FIXTURE_FILE;
assert.ok(path&&isAbsolute(path)&&path.endsWith('.json'));
assert.equal(relative(resolve(tmpdir()),resolve(dirname(path))).startsWith('..'),false);
assert.equal(existsSync(path),true,'Missing local-only eight-identity fixture');
assert.equal(existsSync('supabase/.temp/project-ref'),false,'Hosted project link forbidden');
const config=readFileSync('supabase/config.toml','utf8');
assert.match(config,/^project_id = "tutor_v4_isolated"$/m);
const fixture=JSON.parse(readFileSync(path,'utf8'));
assert.equal(fixture.environment,'local');
assert.equal(fixture.apiUrl,'http://127.0.0.1:54321');
const {actors,ids}=fixture;
assert.equal(Object.keys(actors).length,8,'Expected exactly eight independent synthetic QA identities');
const actorIds=Object.values(actors).map(a=>a.id);
assert.equal(new Set(actorIds).size,8);
assert.ok(fixture.anonKey);

async function login(actor){
 const res=await fetch(fixture.apiUrl+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:fixture.anonKey,'content-type':'application/json'},
  body:JSON.stringify({email:actor.email,password:actor.password})
 });
 assert.equal(res.status,200,'Local GoTrue password sign-in failed');
 const data=await res.json();
 assert.ok(data.access_token);return data.access_token;
}
async function call(token,method,path,body){
 const res=await fetch(fixture.apiUrl+'/rest/v1/'+path,{
  method,headers:{apikey:fixture.anonKey,Authorization:'Bearer '+token,
   'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const value=await res.json().catch(()=>null);
 return {status:res.status,value};
}
async function rpc(token,name,args={}){
 const r=await call(token,'POST','rpc/'+name,args);
 assert.equal(r.status,200,'Expected authorized local '+name);
 return r.value;
}
async function denied(token,name,args={}){
 const r=await call(token,'POST','rpc/'+name,args);
 assert.ok([401,403,404].includes(r.status),
  'Expected hard denial of '+name+' but got '+r.status);
}
async function rows(token,table){
 const r=await call(token,'GET',table+'?select=id');
 assert.equal(r.status,200);
 return r.value;
}
const tok={};
for(const [name,actor] of Object.entries(actors))tok[name]=await login(actor);
const [A,B,C,D,E,F,G,H]=[
 tok.managerA,tok.teacherA,tok.unassignedA,
 tok.studentA1,tok.studentA2,tok.managerB,tok.teacherB,tok.studentB
];
for(const token of [D,E,H]){
 assert.deepEqual(await rows(token,'v5_team_lessons'),[],
  'Unlinked student cannot read full notes-bearing lesson table');
 assert.deepEqual(await rpc(token,'v5_my_team_student_links'),[]);
 assert.deepEqual(await rpc(token,'v5_my_team_student_lessons'),[]);
}
// Manager A creates two student-specific invitations. Teacher B and foreign
// manager F must not be able to invite Team A students.
await denied(B,'v5_invite_team_student',
 {p_student_id:ids.saShared,p_recipient_email:actors.studentA1.email});
await denied(F,'v5_invite_team_student',
 {p_student_id:ids.saShared,p_recipient_email:actors.studentA1.email});
const aD=await rpc(A,'v5_invite_team_student',
 {p_student_id:ids.saShared,p_recipient_email:actors.studentA1.email.toUpperCase()});
const aE=await rpc(A,'v5_invite_team_student',
 {p_student_id:ids.saPrivate,p_recipient_email:actors.studentA2.email});
const bH=await rpc(F,'v5_invite_team_student',
 {p_student_id:ids.sbPrivate,p_recipient_email:actors.studentB.email});
for(const data of [aD,aE,bH]){
 assert.equal(data.status,'pending');assert.ok(data.invitation_id);
}
// No one can accept another person's email invitation, even after normal login.
await denied(E,'v5_accept_team_student_invitation',{p_invitation_id:aD.invitation_id});
await denied(H,'v5_accept_team_student_invitation',{p_invitation_id:aE.invitation_id});
await denied(D,'v5_accept_team_student_invitation',{p_invitation_id:bH.invitation_id});
assert.equal((await rpc(D,'v5_my_team_student_invitations')).length,1);
assert.equal((await rpc(E,'v5_my_team_student_invitations')).length,1);
assert.equal((await rpc(H,'v5_my_team_student_invitations')).length,1);
assert.deepEqual(await rpc(B,'v5_my_team_student_invitations'),[]);
assert.equal((await rpc(D,'v5_accept_team_student_invitation',{p_invitation_id:aD.invitation_id})).status,'accepted');
assert.equal((await rpc(E,'v5_accept_team_student_invitation',{p_invitation_id:aE.invitation_id})).status,'accepted');
assert.equal((await rpc(H,'v5_accept_team_student_invitation',{p_invitation_id:bH.invitation_id})).status,'accepted');
assert.deepEqual(await rpc(D,'v5_my_team_student_invitations'),[]);
const ownerLesson=async token=>(await rpc(token,'v5_my_team_student_lessons'))
 .map(l=>l.subject).sort();
assert.deepEqual(await ownerLesson(D),['RAP12 Shared Math']);
assert.deepEqual(await ownerLesson(E),['RAP12 Private Science']);
assert.deepEqual(await ownerLesson(H),['RAP12 Foreign English']);
for(const token of [D,E,H]){
 assert.deepEqual(await rows(token,'v5_team_lessons'),[],
  'Student can only access minimal-fields RPC, never full private notes');
 assert.deepEqual(await rows(token,'v5_team_students'),[],
  'Student must not enumerate other Team students');
}
const payload=JSON.stringify(await rpc(D,'v5_my_team_student_lessons'));
for(const forbidden of ['notes','hourly_rate_cents','amount_cents',
 'payment','refund','student_id','teacher_user_id','created_by']){
 assert.ok(!payload.includes('"'+forbidden+'"'),'Private field leaked: '+forbidden);
}
for(const [token,teamId] of [[D,ids.teamA],[E,ids.teamA],[H,ids.teamB]]){
 await denied(token,'v5_team_billing_overview',
  {p_team_id:teamId,p_month:fixture.month+'-01'});
 await denied(token,'v5_team_payment_overview',
  {p_team_id:teamId,p_month:fixture.month+'-01'});
}
const ownerManager=await rpc(A,'v5_team_student_manager_overview');
assert.equal(ownerManager.students.length,2);
assert.equal(ownerManager.links.length,2);
const otherManager=await rpc(F,'v5_team_student_manager_overview');
assert.equal(otherManager.students.length,1);
assert.equal(otherManager.links.length,1);
const teacherManager=await rpc(B,'v5_team_student_manager_overview');
assert.deepEqual(teacherManager.students,[]);
assert.deepEqual(teacherManager.pending,[]);
assert.deepEqual(teacherManager.links,[]);
// Active-link uniqueness: manager cannot silently replace a linked student.
const duplicate=await call(A,'POST','rpc/v5_invite_team_student',
 {p_student_id:ids.saShared,p_recipient_email:actors.studentA2.email});
assert.ok([400,409,403].includes(duplicate.status));
// Foreign manager and assigned teacher cannot revoke another student's link.
const dLink=(await rpc(D,'v5_my_team_student_links'))[0];
await denied(F,'v5_revoke_team_student_link',{p_link_id:dLink.id});
await denied(B,'v5_revoke_team_student_link',{p_link_id:dLink.id});
await rpc(A,'v5_revoke_team_student_link',{p_link_id:dLink.id});
// Reuse D's original still-valid JWT: backend authorization ends immediately.
assert.deepEqual(await ownerLesson(D),[]);
assert.deepEqual(await rpc(D,'v5_my_team_student_links'),[]);
assert.deepEqual(await ownerLesson(E),['RAP12 Private Science']);
assert.deepEqual(await ownerLesson(H),['RAP12 Foreign English']);
await denied(D,'v5_accept_team_student_invitation',{p_invitation_id:aD.invitation_id});
// An expired invitation cannot be accepted: this uses only the disposable
// instance's manager-facing revoke/reinvite flow, not Production Auth.
const renewed=await rpc(A,'v5_invite_team_student',
 {p_student_id:ids.saShared,p_recipient_email:actors.studentA1.email});
assert.ok(renewed.invitation_id);
await rpc(A,'v5_revoke_team_student_invitation',
 {p_invitation_id:renewed.invitation_id});
await denied(D,'v5_accept_team_student_invitation',
 {p_invitation_id:renewed.invitation_id});
const pendingAgain=await rpc(D,'v5_my_team_student_invitations');
assert.deepEqual(pendingAgain,[]);
console.log(JSON.stringify({
 result:'PASS',scope:'disposable-local',signedGoTrueActors:8,
 linkedStudentReadPositive:3,isolatedStudentLessonViews:3,
 studentFinanceRpcDenied:6,foreignAcceptDenied:3,
 crossTeamRevokeDenied:2,revokedSameJwtDenied:true,
 fullLessonTableAccess:0,productionWrites:0
}));
