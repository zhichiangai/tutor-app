// V5.2 isolated Team RLS: real local Auth/JWT and PostgREST, no Production.
import {test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(process.env.V4_E2E_LOCAL!=='1')throw Error('V5.2 refuses non-isolated test');
const path=process.env.V4_E2E_FIXTURE_FILE;
if(!path?.startsWith('/'))throw Error('Absolute disposable fixture required');
const f=JSON.parse(readFileSync(path,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
function db(sql){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
   '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',sql],
  {encoding:'utf8'}).trim();
}
async function signIn(role){
 const u=f.actors[role];
 const r=await fetch(f.apiUrl+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:f.anonKey,'content-type':'application/json'},
  body:JSON.stringify({email:u.email,password:u.password})
 });
 assert.equal(r.status,200,'Synthetic local login');
 return (await r.json()).access_token;
}
async function rest(jwt,method,path,body=null){
 const response=await fetch(f.apiUrl+'/rest/v1/'+path,{
  method,headers:{apikey:f.anonKey,Authorization:'Bearer '+jwt,
   'content-type':'application/json',Prefer:'return=representation'},
  ...(body===null?{}:{body:JSON.stringify(body)})
 });
 return {status:response.status,data:await response.json().catch(()=>null)};
}
const rows=(jwt,resource,where='')=>rest(jwt,'GET',resource+'?select=*'+where);

test('Team projects stay isolated until teacher accepts email invitation and is assigned',async()=>{
 const owner=await signIn('teacher');
 const guest=await signIn('stranger');
 const other=await signIn('parent');
 const ownerId=f.actors.teacher.id,guestId=f.actors.stranger.id;
 const ws=db("select id from public.workspaces where owner_id='"+ownerId+"'");
 assert.match(ws,/^[0-9a-f-]{36}$/i);

 // V5.1 prior test leaves a paid or downgraded plan; force Free baseline.
 db("select tutor_private.v5_admin_grant_entitlement('"+ws+"','free',0,"+
  "'V5.2 CI operator','Synthetic pre-upgrade denial test');");
 let r=await rest(owner,'POST','v5_team_projects?select=id',{
  workspace_id:ws,name:'Should not create while Free',created_by:ownerId
 });
 assert.notEqual(r.status,201,'Free owner must not create Team project');
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[]);

 db("select tutor_private.v5_admin_grant_entitlement('"+ws+"','team',0,"+
  "'V5.2 CI operator','Synthetic Team test entitlement');");
 r=await rest(owner,'POST','v5_team_projects?select=id,name',{
  workspace_id:ws,name:'Project Alpha',created_by:ownerId
 });
 assert.equal(r.status,201);
 const alpha=r.data[0].id;
 r=await rest(owner,'POST','v5_team_projects?select=id,name',{
  workspace_id:ws,name:'Project Beta',created_by:ownerId
 });
 assert.equal(r.status,201);
 const beta=r.data[0].id;
 assert.notEqual(alpha,beta);
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[]);
 // RLS prevents unrelated account from creating projects.
 assert.notEqual((await rest(guest,'POST','v5_team_projects?select=id',{
  workspace_id:ws,name:'Intruder',created_by:guestId
 })).status,201);

 // Invitation is visible to only owner and addressed recipient.
 const email=f.actors.stranger.email.toLowerCase();
 r=await rest(owner,'POST','v5_team_invitations?select=id,status',{
  workspace_id:ws,recipient_email:email,invited_by:ownerId
 });
 assert.equal(r.status,201);
 const invite=r.data[0].id;
 const seen=await rows(guest,'v5_team_invitations','&id=eq.'+invite);
 assert.equal(seen.status,200);
 assert.equal(seen.data.length,1);
 const hidden=await rows(other,'v5_team_invitations','&id=eq.'+invite);
 assert.deepEqual(hidden.data,[]);
 assert.notEqual((await rest(other,'POST','rpc/v5_accept_team_invitation',
  {p_invitation_id:invite})).status,200,'Wrong email cannot accept invite');
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[],
  'Pending invitation grants no project access');
 const accepted=await rest(guest,'POST','rpc/v5_accept_team_invitation',
  {p_invitation_id:invite});
 assert.equal(accepted.status,200);
 assert.equal(accepted.data.status,'accepted');
 assert.notEqual((await rest(guest,'POST','rpc/v5_accept_team_invitation',
  {p_invitation_id:invite})).status,200,'Invitation is one-time');
 const memberships=await rows(guest,'workspace_members','&workspace_id=eq.'+ws);
 assert.equal(memberships.data.some(m=>m.user_id===guestId&&m.role==='teacher'),true);
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[],
  'Team membership alone grants no project visibility');

 // Assign exactly Project Alpha to teacher. Project Beta stays invisible.
 r=await rest(owner,'POST','v5_team_project_members?select=project_id,user_id',{
  project_id:alpha,workspace_id:ws,user_id:guestId
 });
 assert.equal(r.status,201);
 const visible=await rows(guest,'v5_team_projects');
 assert.equal(visible.status,200);
 assert.deepEqual(visible.data.map(p=>p.id).sort(),[alpha]);
 assert.notEqual((await rest(guest,'POST','v5_team_project_members?select=project_id',{
  project_id:beta,workspace_id:ws,user_id:guestId
 })).status,201,'Non-owner cannot self-assign');
 assert.notEqual((await rest(guest,'POST','v5_team_invitations?select=id',{
  workspace_id:ws,recipient_email:f.actors.parent.email,invited_by:guestId
 })).status,201,'Teacher cannot invite other teachers');

 // Owner removes teacher membership: ON DELETE CASCADE removes assignments;
 // the SAME JWT immediately stops seeing Project Alpha.
 r=await rest(owner,'DELETE','workspace_members?workspace_id=eq.'+ws+
  '&user_id=eq.'+guestId);
 assert.equal(r.status,200);
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[],
  'Same valid JWT must lose project access after removing membership');
 const remaining=await rows(owner,'v5_team_projects');
 assert.equal(remaining.data.length,2,'Revocation must retain project history');
 assert.equal(Number(db("select count(*) from public.v5_team_project_members "+
  "where project_id='"+alpha+"' and user_id='"+guestId+"'")),0);
});
