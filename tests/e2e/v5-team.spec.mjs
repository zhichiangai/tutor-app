// V5.2 isolated Team RLS: real local Auth/JWT and PostgREST, no Production.
import {test,expect} from '@playwright/test';
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

 // Tenant-isolation regression: the parent owns a separate synthetic Team.
 // Teacher A must never read Team B projects, members or invitations.
 const otherId=f.actors.parent.id;
 let otherWs=db("select id from public.workspaces where owner_id='"+otherId+"'");
 if(!otherWs){
  const created=await rest(other,'POST','workspaces?select=id',{
   owner_id:otherId,kind:'individual',name:'Synthetic other tenant'
  });
  assert.equal(created.status,201);
  otherWs=created.data[0].id;
 }
 assert.notEqual(ws,otherWs);
 db("select tutor_private.v5_admin_grant_entitlement('"+otherWs+"','team',0,"+
  "'V5.2 CI operator','Synthetic separate-tenant entitlement');");
 const foreignProject=await rest(other,'POST','v5_team_projects?select=id',{
  workspace_id:otherWs,name:'Private Team B Project',created_by:otherId
 });
 assert.equal(foreignProject.status,201);
 assert.equal((await rows(owner,'v5_team_projects')).data.some(
  p=>p.id===foreignProject.data[0].id),false,
  'Team A owner must not see Team B projects');
 assert.deepEqual((await rows(owner,'workspace_members',
   '&workspace_id=eq.'+otherWs)).data,[],
  'Team A owner cannot enumerate Team B members');
 const foreignInvite=await rest(other,'POST','v5_team_invitations?select=id',{
  workspace_id:otherWs,recipient_email:f.actors.stranger.email.toLowerCase(),
  invited_by:otherId
 });
 assert.equal(foreignInvite.status,201);
 assert.deepEqual((await rows(owner,'v5_team_invitations',
   '&id=eq.'+foreignInvite.data[0].id)).data,[],
  'Team A owner must not read Team B invitations');

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
 assert.notEqual((await rest(owner,'PATCH','v5_team_projects?id=eq.'+alpha,
  {workspace_id:otherWs})).status,200,
  'Owner cannot move a project into another workspace');
 assert.notEqual((await rest(owner,'PATCH','v5_team_projects?id=eq.'+alpha,
  {created_by:otherId})).status,200,
  'Creator identity must be immutable');
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
 const archived=await rest(owner,'PATCH','v5_team_projects?id=eq.'+beta,
  {status:'archived'});
 assert.equal(archived.status,200);
 assert.notEqual((await rest(owner,'POST','v5_team_project_members?select=project_id',{
  project_id:beta,workspace_id:ws,user_id:guestId
 })).status,201,'Archived project cannot receive new teacher assignment');
 assert.notEqual((await rest(guest,'POST','v5_team_invitations?select=id',{
  workspace_id:ws,recipient_email:f.actors.parent.email,invited_by:guestId
 })).status,201,'Teacher cannot invite other teachers');

 // Owner removes teacher membership: ON DELETE CASCADE removes assignments;
 // the SAME JWT immediately stops seeing Project Alpha.
 r=await rest(owner,'DELETE','workspace_members?workspace_id=eq.'+ws+
  '&user_id=eq.'+guestId);
 assert.notEqual(r.status,200,'Membership cannot be deleted without audit RPC');
 r=await rest(owner,'POST','rpc/v5_remove_team_teacher',{
  p_workspace_id:ws,p_user_id:guestId
 });
 assert.ok([200,204].includes(r.status),'Owner removal is an audited RPC');
 assert.equal(db("select count(*) from tutor_private.v5_team_membership_audit "+
  "where workspace_id='"+ws+"' and subject_user_id='"+guestId+"' "+
  "and event='teacher_removed'"),'1');
 assert.deepEqual((await rows(guest,'v5_team_projects')).data,[],
  'Same valid JWT must lose project access after removing membership');
 const remaining=await rows(owner,'v5_team_projects');
 assert.equal(remaining.data.length,2,'Revocation must retain project history');
 assert.equal(Number(db("select count(*) from public.v5_team_project_members "+
  "where project_id='"+alpha+"' and user_id='"+guestId+"'")),0);
});


test('Team settings shows authorized projects and hides private Team UI on logout',async({page})=>{
 const actor=f.actors.teacher;
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url,publishableKey:key
  };
 },{url:f.apiUrl,key:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
 await page.evaluate(async({url,key,email,password})=>{
  const client=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic login error');
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-owner-controls')).toBeVisible();
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Alpha');
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Beta');
 await page.locator('#v5-team-project-name').fill('Project Gamma via GUI');
 await page.locator('#v5-team-project-form button[type="submit"]').click();
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Gamma via GUI');
 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-team-card')).toBeHidden();
 await expect(page.locator('#v5-team-project-list')).toBeEmpty();
});


test('teacher can exit a Team without changing personal workspace or history',async()=>{
 const owner=await signIn('teacher'),member=await signIn('parent');
 const outsider=await signIn('stranger');
 const ownerId=f.actors.teacher.id,memberId=f.actors.parent.id;
 const teamId=db("select id from public.workspaces where owner_id='"+ownerId+"'");
 const personalId=db("select id from public.workspaces where owner_id='"+memberId+"'");
 assert.match(personalId,/^[0-9a-f-]{36}$/i,'Member owns a separate synthetic workspace');
 assert.notEqual(teamId,personalId);
 const alpha=db("select id from public.v5_team_projects where workspace_id='"+
  teamId+"' and name='Project Alpha'");
 const ownProject=db("select id from public.v5_team_projects where workspace_id='"+
  personalId+"' and name='Private Team B Project'");
 assert.match(ownProject,/^[0-9a-f-]{36}$/i);
 const initialTeamRows=Number(db("select count(*) from public.v5_team_projects "+
  "where workspace_id='"+teamId+"'"));
 const invite=await rest(owner,'POST','v5_team_invitations?select=id',{
  workspace_id:teamId,recipient_email:f.actors.parent.email.toLowerCase(),
  invited_by:ownerId
 });
 assert.equal(invite.status,201);
 assert.equal((await rest(member,'POST','rpc/v5_accept_team_invitation',
  {p_invitation_id:invite.data[0].id})).status,200);
 const assignment=await rest(owner,'POST','v5_team_project_members?select=project_id',{
  project_id:alpha,workspace_id:teamId,user_id:memberId
 });
 assert.equal(assignment.status,201);
 const before=(await rows(member,'v5_team_projects')).data.map(p=>p.id);
 assert.ok(before.includes(alpha));
 assert.ok(before.includes(ownProject));

 const denyOwner=await rest(owner,'POST','rpc/v5_leave_team',{p_workspace_id:teamId});
 assert.notEqual(denyOwner.status,200,'Owner must first transfer management rights');
 const denyOther=await rest(outsider,'POST','rpc/v5_leave_team',{p_workspace_id:teamId});
 assert.notEqual(denyOther.status,200,'Non-member cannot exit another workspace');

 const departed=await rest(member,'POST','rpc/v5_leave_team',{p_workspace_id:teamId});
 assert.equal(departed.status,200);
 assert.equal(departed.data.left,true);
 const after=(await rows(member,'v5_team_projects')).data.map(p=>p.id);
 assert.ok(!after.includes(alpha),'Same JWT immediately loses Team Alpha');
 assert.ok(after.includes(ownProject),'Personal workspace data is unaffected');
 assert.equal(Number(db("select count(*) from public.v5_team_project_members "+
  "where workspace_id='"+teamId+"' and user_id='"+memberId+"'")),0);
 assert.equal(Number(db("select count(*) from public.v5_team_projects "+
  "where workspace_id='"+teamId+"'")),initialTeamRows);
 assert.equal(db("select count(*) from tutor_private.v5_team_membership_audit "+
  "where workspace_id='"+teamId+"' and subject_user_id='"+memberId+"' "+
  "and event='teacher_left'"),'1');
 assert.notEqual((await rest(member,'POST','rpc/v5_leave_team',{
  p_workspace_id:teamId
 })).status,200,'Repeated exit must not silently succeed');
});


test('manager transfer requires acceptance; personal V4 owner stays unchanged',async()=>{
 const owner=await signIn('teacher');
 const successor=await signIn('parent');
 const outsider=await signIn('stranger');
 const ownerId=f.actors.teacher.id,successorId=f.actors.parent.id;
 const ws=db("select id from public.workspaces where owner_id='"+ownerId+"'");
 const personal=db("select id from public.workspaces where owner_id='"+successorId+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Project Alpha'");
 const beforeProjectCount=Number(db("select count(*) from public.v5_team_projects "+
  "where workspace_id='"+ws+"'"));
 const beforeLessonCount=Number(db("select count(*) from public.lesson_records "+
  "where owner_id='"+ownerId+"'"));
 assert.match(project,/^[a-f0-9-]{36}$/i);
 assert.notEqual(personal,ws);

 // A team manager cannot nominate strangers or transfer to their own ID.
 assert.notEqual((await rest(owner,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:f.actors.stranger.id
 })).status,200);
 assert.notEqual((await rest(owner,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:ownerId
 })).status,200);
 assert.notEqual((await rest(outsider,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:successorId
 })).status,200);

 // Successor previously left Team: joining again is deliberate and separate.
 let invitation=await rest(owner,'POST','v5_team_invitations?select=id',{
  workspace_id:ws,recipient_email:f.actors.parent.email.toLowerCase(),
  invited_by:ownerId
 });
 assert.equal(invitation.status,201);
 assert.equal((await rest(successor,'POST','rpc/v5_accept_team_invitation',{
  p_invitation_id:invitation.data[0].id
 })).status,200);
 assert.equal(db("select count(*) from public.v5_team_roster where workspace_id='"+
  ws+"' and user_id='"+successorId+"'"),'1');

 let proposed=await rest(owner,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:successorId
 });
 assert.equal(proposed.status,200);
 let transferId=proposed.data;
 assert.match(transferId,/^[a-f0-9-]{36}$/i);
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
  "where workspace_id='"+ws+"'"),ownerId);
 assert.notEqual((await rest(owner,'POST','rpc/v5_leave_team',{
  p_workspace_id:ws
 })).status,200,'Proposing alone does not allow manager to leave');
 assert.notEqual((await rest(outsider,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:transferId,p_accept:true
 })).status,200,'Only the nominated successor may respond');
 assert.notEqual((await rest(owner,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:transferId,p_accept:true
 })).status,200,'The original manager cannot self-approve transfer');
 let answer=await rest(successor,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:transferId,p_accept:false
 });
 assert.equal(answer.status,200);
 assert.equal(answer.data.status,'declined');
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
  "where workspace_id='"+ws+"'"),ownerId);

 proposed=await rest(owner,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:successorId
 });
 assert.equal(proposed.status,200);
 transferId=proposed.data;
 assert.equal((await rest(owner,'POST','rpc/v5_cancel_team_manager',{
  p_transfer_id:transferId
 })).status,204);
 assert.notEqual((await rest(successor,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:transferId,p_accept:true
 })).status,200,'Cancelled transfer cannot be accepted');

 proposed=await rest(owner,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:successorId
 });
 assert.equal(proposed.status,200);
 transferId=proposed.data;
 answer=await rest(successor,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:transferId,p_accept:true
 });
 assert.equal(answer.status,200);
 assert.equal(answer.data.status,'accepted');
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
  "where workspace_id='"+ws+"'"),successorId);
 assert.equal(db("select owner_id from public.workspaces where id='"+ws+"'"),ownerId,
  'V4 personal workspace ownership must not be reassigned');
 assert.equal(db("select owner_id from public.workspaces where id='"+personal+"'"),successorId);

 const ownerManaged=await rest(owner,'POST','rpc/v5_my_managed_teams',{});
 assert.equal(ownerManaged.status,200);
 assert.equal(ownerManaged.data.some(t=>t.workspace_id===ws),false);
 const successorManaged=await rest(successor,'POST','rpc/v5_my_managed_teams',{});
 assert.equal(successorManaged.status,200);
 assert.equal(successorManaged.data.some(t=>t.workspace_id===ws),true);

 // No cached JWT permission may survive: old owner can no longer govern.
 assert.notEqual((await rest(owner,'POST','v5_team_projects?select=id',{
  workspace_id:ws,name:'Must be denied after transfer',created_by:ownerId
 })).status,201);
 assert.notEqual((await rest(owner,'POST','v5_team_invitations?select=id',{
  workspace_id:ws,recipient_email:'future.teacher@example.test',invited_by:ownerId
 })).status,201);
 assert.notEqual((await rest(owner,'POST','rpc/v5_remove_team_teacher',{
  p_workspace_id:ws,p_user_id:successorId
 })).status,200);
 assert.notEqual((await rest(successor,'POST','rpc/v5_leave_team',{
  p_workspace_id:ws
 })).status,200,'New manager must transfer first');

 // The successor can update a project created by the old manager;
 // immutable project creator and Team ID are retained.
 const changed=await rest(successor,'PATCH','v5_team_projects?id=eq.'+project,
  {name:'Project Alpha Renamed by Successor'});
 assert.equal(changed.status,200);
 assert.equal(changed.data.length,1);
 const added=await rest(successor,'POST','v5_team_projects?select=id',{
  workspace_id:ws,name:'Successor Managed Project',created_by:successorId
 });
 assert.equal(added.status,201);

 // Old manager is still an ordinary Team member, and can now depart.
 let departed=await rest(owner,'POST','rpc/v5_leave_team',{p_workspace_id:ws});
 assert.equal(departed.status,200);
 assert.equal(departed.data.left,true);
 assert.equal(db("select owner_id from public.workspaces where id='"+ws+"'"),ownerId);
 assert.equal(db("select count(*) from public.workspace_members where workspace_id='"+
  ws+"' and user_id='"+ownerId+"'"),'1',
  'Legacy V4 owner membership is never removed');
 assert.equal(db("select count(*) from public.v5_team_roster where workspace_id='"+
  ws+"' and user_id='"+ownerId+"'"),'0');
 const ownerTeamView=await rows(owner,'v5_team_projects');
 assert.equal(ownerTeamView.data.some(p=>p.workspace_id===ws),false);
 assert.equal(Number(db("select count(*) from public.lesson_records where owner_id='"+
  ownerId+"'")),beforeLessonCount,'V4 personal lesson history must remain');
 assert.equal(Number(db("select count(*) from public.v5_team_projects where workspace_id='"+
  ws+"'")),beforeProjectCount+1,'Team projects survive transfer and exit');
 assert.equal(db("select count(*) from tutor_private.v5_team_governance_audit "+
  "where workspace_id='"+ws+"' and event='accepted'"),'1');
 assert.equal(db("select count(*) from tutor_private.v5_team_membership_audit "+
  "where workspace_id='"+ws+"' and actor_id='"+ownerId+"' "+
  "and event='teacher_left'"),'1');
});


test('successor sees transferred Team in the settings UI without V4 data',async({page})=>{
 const actor=f.actors.parent;
 const original=f.actors.teacher;
 const ownedTeam=db("select id from public.workspaces where owner_id='"+original.id+"'");
 const personalTeam=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 // Disposable synthetic profile only: this account was originally a parent in
 // V4 tests. It now explicitly opts in to teacher mode for Team management UI.
 db("update public.profiles set last_role='teacher',"+
  "enabled_roles=array['parent','teacher']::text[],roles_configured=true "+
  "where id='"+actor.id+"'");
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url,publishableKey:key
  };
 },{url:f.apiUrl,key:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
 await page.evaluate(async({url,key,email,password})=>{
  const client=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic new manager login failed');
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-owner-controls')).toBeVisible();
 const teams=await page.locator('#v5-team-manage-select option').evaluateAll(
  els=>els.map(x=>x.value));
 assert.ok(teams.includes(ownedTeam),'Transferred team is manageable');
 assert.ok(teams.includes(personalTeam),'Personal Team management remains');
 await page.locator('#v5-team-manage-select').selectOption(ownedTeam);
 await expect(page.locator('#v5-team-project-list')).toContainText(
  'Project Alpha Renamed by Successor');
 await expect(page.locator('#v5-team-transfer-list')).toContainText(
  '目前沒有待確認的管理權轉讓');
 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-team-card')).toBeHidden();
});


test('V5.3 Team students and lessons stay independent of V4 personal data and manager transfer',async()=>{
 const oldOwner=await signIn('teacher');
 const manager=await signIn('parent');
 const outsider=await signIn('stranger');
 const oldId=f.actors.teacher.id,managerId=f.actors.parent.id;
 const anchor=db("select id from public.workspaces where owner_id='"+oldId+"'");
 const personal=db("select id from public.workspaces where owner_id='"+managerId+"'");
 const teamId=db("select id from public.v5_teams where anchor_workspace_id='"+anchor+"'");
 const otherTeam=db("select id from public.v5_teams where anchor_workspace_id='"+personal+"'");
 assert.match(teamId,/^[a-f0-9-]{36}$/i);
 assert.notEqual(teamId,otherTeam,'Two Team identities must be independent');
 const alpha=db("select id from public.v5_team_projects where workspace_id='"+
  anchor+"' and name='Project Alpha Renamed by Successor'");
 const foreignProject=db("select id from public.v5_team_projects where workspace_id='"+
  personal+"' and name='Private Team B Project'");
 assert.equal(db("select team_id from public.v5_team_projects where id='"+alpha+"'"),teamId);
 const oldStudents=Number(db("select count(*) from public.students where workspace_id='"+
  anchor+"'"));
 const oldLessons=Number(db("select count(*) from public.lesson_records where owner_id='"+
  oldId+"'"));
 const oldV4Seats=Number(db("select count(*) from tutor_private.v5_student_seat_ledger "+
  "where workspace_id='"+anchor+"'"));
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
  "where workspace_id='"+anchor+"'"),managerId,
  'Team management already transferred in preceding local isolated test');
 assert.deepEqual((await rows(oldOwner,'v5_teams','&id=eq.'+teamId)).data,[],
  'The original V4 owner is not entitled to view departed Team data');
 assert.deepEqual((await rows(outsider,'v5_teams','&id=eq.'+teamId)).data,[]);

 let result=await rest(oldOwner,'POST','v5_team_students?select=id',{
  team_id:teamId,display_name:'Unauthorized V4 owner',created_by:oldId
 });
 assert.notEqual(result.status,201,'V4 workspace owner cannot create Team student after exit');
 result=await rest(outsider,'POST','v5_team_students?select=id',{
  team_id:teamId,display_name:'Cross tenant',created_by:f.actors.stranger.id
 });
 assert.notEqual(result.status,201,'Unrelated teacher cannot create Team student');
 result=await rest(manager,'POST','v5_team_students?select=id,team_id',{
  team_id:teamId,display_name:'Team scoped synthetic learner',created_by:managerId
 });
 assert.equal(result.status,201);
 const student=result.data[0].id;
 assert.equal(result.data[0].team_id,teamId);
 assert.deepEqual((await rows(oldOwner,'v5_team_students','&id=eq.'+student)).data,[],
  'Former manager must not see new Team students');

 // Project belongs to a different Team: both composite foreign keys must
 // reject cross-Team enrollment even for a user managing both Teams.
 result=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:teamId,student_id:student,project_id:foreignProject
 });
 assert.notEqual(result.status,201,'A student cannot be enrolled into another Team project');
 result=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:teamId,student_id:student,project_id:alpha
 });
 assert.equal(result.status,201);
 assert.deepEqual((await rows(oldOwner,'v5_team_enrollments',
  '&student_id=eq.'+student)).data,[]);

 // Rejoin only via a fresh invitation; V4 owner membership alone has no
 // Team access. Assigning a project is a further separate permission.
 const invite=await rest(manager,'POST','v5_team_invitations?select=id',{
  workspace_id:anchor,recipient_email:f.actors.teacher.email.toLowerCase(),
  invited_by:managerId
 });
 assert.equal(invite.status,201);
 assert.equal((await rest(oldOwner,'POST','rpc/v5_accept_team_invitation',{
  p_invitation_id:invite.data[0].id
 })).status,200);
 assert.deepEqual((await rows(oldOwner,'v5_team_students',
  '&id=eq.'+student)).data,[],
  'Roster membership must not reveal all Team students');

 const assignment=await rest(manager,'POST','v5_team_project_members?select=project_id',{
  project_id:alpha,workspace_id:anchor,user_id:oldId
 });
 assert.equal(assignment.status,201);
 assert.equal((await rows(oldOwner,'v5_team_students','&id=eq.'+student)).data.length,1);
 assert.equal((await rows(oldOwner,'v5_team_enrollments',
  '&student_id=eq.'+student)).data.length,1);

 const start='2030-04-05T10:00:00.000Z',end='2030-04-05T11:30:00.000Z';
 const bad=await rest(outsider,'POST','v5_team_lessons?select=id',{
  team_id:teamId,project_id:alpha,student_id:student,
  teacher_user_id:f.actors.stranger.id,subject:'Cross tenant',
  lesson_start:start,lesson_end:end
 });
 assert.notEqual(bad.status,201);
 result=await rest(oldOwner,'POST','v5_team_lessons?select=id,teacher_user_id',{
  team_id:teamId,project_id:alpha,student_id:student,teacher_user_id:oldId,
  subject:'V5 Team isolated math',lesson_start:start,lesson_end:end
 });
 assert.equal(result.status,201);
 const lesson=result.data[0].id;
 assert.equal(result.data[0].teacher_user_id,oldId);
 assert.equal((await rows(oldOwner,'v5_team_lessons','&id=eq.'+lesson)).data.length,1);
 assert.equal((await rows(manager,'v5_team_lessons','&id=eq.'+lesson)).data.length,1);
 assert.deepEqual((await rows(outsider,'v5_team_lessons','&id=eq.'+lesson)).data,[]);
 assert.deepEqual((await rows(outsider,'v5_team_students','&id=eq.'+student)).data,[]);

 result=await rest(oldOwner,'PATCH','v5_team_lessons?id=eq.'+lesson,{
  status:'completed',notes:'Synthetic course completed'
 });
 assert.equal(result.status,200);
 assert.equal(result.data[0].status,'completed');
 assert.notEqual((await rest(oldOwner,'PATCH','v5_team_lessons?id=eq.'+lesson,{
  teacher_user_id:f.actors.stranger.id
 })).status,200,'Teacher attribution cannot be reassigned through the API');

 // After a teacher leaves, the same JWT must be unable to see Team student
 // and lesson data. Historic lesson attribution is retained for the manager.
 assert.equal((await rest(oldOwner,'POST','rpc/v5_leave_team',{
  p_workspace_id:anchor
 })).status,200);
 assert.deepEqual((await rows(oldOwner,'v5_team_students','&id=eq.'+student)).data,[]);
 assert.deepEqual((await rows(oldOwner,'v5_team_lessons','&id=eq.'+lesson)).data,[]);
 assert.equal((await rows(manager,'v5_team_lessons','&id=eq.'+lesson)).data[0].teacher_user_id,oldId);
 assert.equal(Number(db("select count(*) from public.students where workspace_id='"+
  anchor+"'")),oldStudents,'No V4 students migrated or altered');
 assert.equal(Number(db("select count(*) from public.lesson_records where owner_id='"+
  oldId+"'")),oldLessons,'No V4 lesson records changed');
 assert.equal(Number(db("select count(*) from tutor_private.v5_student_seat_ledger "+
  "where workspace_id='"+anchor+"'")),oldV4Seats,'V4 personal quota ledger unchanged');
 assert.equal(db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'"),'1',
  'Team student is counted exclusively in the Team lifetime ledger');
 assert.equal(db("select owner_id from public.workspaces where id='"+anchor+"'"),oldId);
});

test('V5.3 Team student lifetime seats and archived status do not erase history',async()=>{
 const manager=await signIn('parent');
 const oldOwner=await signIn('teacher');
 const oldId=f.actors.teacher.id,managerId=f.actors.parent.id;
 const anchor=db("select id from public.workspaces where owner_id='"+oldId+"'");
 const teamId=db("select id from public.v5_teams where anchor_workspace_id='"+anchor+"'");
 const student=db("select id from public.v5_team_students where team_id='"+
  teamId+"' and display_name='Team scoped synthetic learner'");
 const lesson=db("select id from public.v5_team_lessons where team_id='"+
  teamId+"' and subject='V5 Team isolated math'");
 assert.match(student,/^[a-f0-9-]{36}$/i);
 const ledgerCount=db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'");
 let r=await rest(manager,'PATCH','v5_team_students?id=eq.'+student,
  {is_archived:true});
 assert.equal(r.status,200);
 assert.notEqual((await rest(manager,'DELETE','v5_team_students?id=eq.'+student)).status,200,
  'Team student hard-delete is not available through the browser');
 assert.notEqual((await rest(manager,'POST','v5_team_students?select=id',{
  id:student,team_id:teamId,display_name:'Recycled identifier',
  created_by:managerId
 })).status,201,'Lifetime student UUID cannot be recycled');
 assert.equal(db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'"),ledgerCount);
 assert.equal(db("select count(*) from public.v5_team_lessons where id='"+
  lesson+"'"),'1','Archiving Team student must not erase historic lessons');
 assert.deepEqual((await rows(oldOwner,'v5_team_students','&id=eq.'+student)).data,[],
  'Departed V4 owner remains unable to see archived Team students');
});


test('V5.3 manager uses Team student and shared lesson calendar UI without V4 writes',async({page})=>{
 const actor=f.actors.parent;
 const manager=await signIn('parent');
 const workspace=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 const teamId=db("select id from public.v5_teams where anchor_workspace_id='"+workspace+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  workspace+"' and name='Private Team B Project'");
 assert.match(teamId,/^[a-f0-9-]{36}$/i);
 assert.match(project,/^[a-f0-9-]{36}$/i);

 const assigned=await rest(manager,'POST','v5_team_project_members?select=project_id',{
  project_id:project,workspace_id:workspace,user_id:actor.id
 });
 assert.equal(assigned.status,201,'Synthetic manager assigned to own Team B project');
 const beforeV4=db("select count(*) from public.lesson_records where owner_id='"+
  actor.id+"'");
 const beforeTeamSeats=Number(db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'"));

 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url,publishableKey:key
  };
 },{url:f.apiUrl,key:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
 await page.evaluate(async({url,key,email,password})=>{
  const supa=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await supa.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic V5.3 manager login failed');
  supa.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-learning-card')).toBeVisible();
 await expect(page.locator('#v5-learning-manager-controls')).toBeVisible();
 await page.locator('#v5-learning-team-select').selectOption(teamId);
 await expect(page.locator('#v5-learning-project-select')).toHaveValue(project);

 await page.locator('#v5-learning-student-name').fill('GUI Synthetic Student 532');
 await page.locator('#v5-learning-student-form button[type="submit"]').click();
 await expect(page.locator('#v5-learning-enroll-student')).toContainText(
  'GUI Synthetic Student 532');
 const student=db("select id from public.v5_team_students "+
  "where team_id='"+teamId+"' and display_name='GUI Synthetic Student 532'");
 assert.match(student,/^[a-f0-9-]{36}$/i);
 await page.locator('#v5-learning-enroll-student').selectOption(student);
 await page.locator('#v5-learning-enroll-submit').click();
 await expect(page.locator('#v5-learning-students')).toContainText('GUI Synthetic Student 532');

 const current=await page.evaluate(()=>{
  const d=new Date();
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0');
  return y+'-'+m;
 });
 await page.locator('#v5-learning-lesson-student').selectOption(student);
 await page.locator('#v5-learning-lesson-teacher').selectOption(actor.id);
 await page.locator('#v5-learning-lesson-subject').fill('Math Team GUI QA');
 await page.locator('#v5-learning-lesson-start').fill(current+'-15T10:00');
 await page.locator('#v5-learning-lesson-end').fill(current+'-15T11:00');
 await page.locator('#v5-learning-lesson-notes').fill('Synthetic cross-teacher schedule entry');
 await page.locator('#v5-learning-lesson-submit').click();
 await expect(page.locator('#v5-learning-lessons')).toContainText('Math Team GUI QA');
 await expect(page.locator('#v5-learning-calendar')).toContainText('Math Team GUI QA');
 const lesson=db("select id from public.v5_team_lessons "+
  "where student_id='"+student+"' and subject='Math Team GUI QA'");
 assert.match(lesson,/^[a-f0-9-]{36}$/i);
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('[data-v5-learning-action="update-lesson"][data-id="'+lesson+'"]'+
  '[data-status="completed"]').click();
 await expect(page.locator('#v5-learning-lessons')).toContainText('已完成');
 assert.equal(db("select status from public.v5_team_lessons where id='"+lesson+"'"),'completed');
 assert.equal(db("select count(*) from public.lesson_records where owner_id='"+
  actor.id+"'"),beforeV4,'UI must never mutate V4 lessons');
 assert.equal(Number(db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'")),beforeTeamSeats+1);

 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-learning-card')).toBeHidden();
 await expect(page.locator('#v5-learning-students')).toBeEmpty();
 await expect(page.locator('#v5-learning-lessons')).toBeEmpty();
});


test('V5.3 shared calendar shows two teachers; assigned teacher has no manager controls',async({page})=>{
 const managerJwt=await signIn('parent'),teacherJwt=await signIn('teacher');
 const managerActor=f.actors.parent,teacherActor=f.actors.teacher;
 const workspace=db("select id from public.workspaces where owner_id='"+managerActor.id+"'");
 const originalWorkspace=db("select id from public.workspaces where owner_id='"+teacherActor.id+"'");
 const teamId=db("select id from public.v5_teams where anchor_workspace_id='"+workspace+"'");
 const oldTeam=db("select id from public.v5_teams where anchor_workspace_id='"+
  originalWorkspace+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  workspace+"' and name='Private Team B Project'");
 const student=db("select id from public.v5_team_students where team_id='"+
  teamId+"' and display_name='GUI Synthetic Student 532'");
 assert.match(student,/^[a-f0-9-]{36}$/i);

 let r=await rest(managerJwt,'POST','v5_team_invitations?select=id',{
  workspace_id:workspace,recipient_email:teacherActor.email.toLowerCase(),
  invited_by:managerActor.id
 });
 assert.equal(r.status,201);
 assert.equal((await rest(teacherJwt,'POST','rpc/v5_accept_team_invitation',{
  p_invitation_id:r.data[0].id
 })).status,200);
 r=await rest(managerJwt,'POST','v5_team_project_members?select=project_id',{
  workspace_id:workspace,project_id:project,user_id:teacherActor.id
 });
 assert.equal(r.status,201,'Team manager assigns a second real synthetic teacher');

 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={environment:'local',isolated:true,projectRef:'local',
   url,publishableKey:key};
 },{url:f.apiUrl,key:f.anonKey});
 async function enter(role){
  const actor=f.actors[role];
  await page.goto('/v2/index.html');
  await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
  await page.evaluate(async({url,key,email,password})=>{
   const supa=window.supabase.createClient(url,key,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
   });
   const {error}=await supa.auth.signInWithPassword({email,password});
   if(error)throw Error('Synthetic Team GUI login failed');
   supa.auth.stopAutoRefresh?.();
  },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/login-required/);
  await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
  await expect(page.locator('#v5-learning-card')).toBeVisible();
  await page.locator('#v5-learning-team-select').selectOption(teamId);
  await expect(page.locator('#v5-learning-project-select')).toHaveValue(project);
 }
 await enter('parent');
 await expect(page.locator('#v5-learning-manager-controls')).toBeVisible();
 const opts=await page.locator('#v5-learning-lesson-teacher option').evaluateAll(
  els=>els.map(x=>x.value));
 assert.ok(opts.includes(managerActor.id));
 assert.ok(opts.includes(teacherActor.id));
 const month=await page.evaluate(()=>{
  const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
 });
 await page.locator('#v5-learning-lesson-student').selectOption(student);
 await page.locator('#v5-learning-lesson-teacher').selectOption(teacherActor.id);
 await page.locator('#v5-learning-lesson-subject').fill('Cross Teacher English GUI');
 await page.locator('#v5-learning-lesson-start').fill(month+'-16T14:00');
 await page.locator('#v5-learning-lesson-end').fill(month+'-16T15:30');
 await page.locator('#v5-learning-lesson-submit').click();
 await expect(page.locator('#v5-learning-lessons')).toContainText('Cross Teacher English GUI');
 await expect(page.locator('#v5-learning-lessons')).toContainText('Math Team GUI QA');
 await expect(page.locator('#v5-learning-lessons')).toContainText(
  '老師 · '+teacherActor.id.slice(-6));
 await expect(page.locator('#v5-learning-calendar')).toContainText('Cross Teacher English GUI');

 await page.locator('#sign-out').click();
 await expect(page.locator('#v5-learning-students')).toBeEmpty();
 await enter('teacher');
 await expect(page.locator('#v5-learning-manager-controls')).toBeHidden();
 const teamChoices=await page.locator('#v5-learning-team-select option')
  .evaluateAll(els=>els.map(x=>x.value));
 assert.ok(teamChoices.includes(teamId),'Assigned teacher can open their Team project');
 assert.ok(!teamChoices.includes(oldTeam),'Departed original Team stays inaccessible');
 await expect(page.locator('#v5-learning-lessons')).toContainText('Cross Teacher English GUI');
 await expect(page.locator('#v5-learning-lessons')).toContainText('Math Team GUI QA');
 assert.deepEqual((await rows(teacherJwt,'v5_team_students',
  '&team_id=eq.'+oldTeam)).data,[],
  'Assigned Teacher B may not read their former Team A students');
 await page.locator('#sign-out').click();
 await expect(page.locator('#v5-learning-card')).toBeHidden();
 await expect(page.locator('#v5-learning-calendar')).toBeEmpty();
});


test('V5.3 manager safely renames Team student, edits lesson, archives without losing history',async({page})=>{
 const actor=f.actors.parent;
 const workspace=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 const teamId=db("select id from public.v5_teams where anchor_workspace_id='"+workspace+"'");
 const student=db("select id from public.v5_team_students where team_id='"+
  teamId+"' and display_name='GUI Synthetic Student 532'");
 const lesson=db("select id from public.v5_team_lessons where student_id='"+
  student+"' and subject='Cross Teacher English GUI'");
 const teacherId=db("select teacher_user_id from public.v5_team_lessons where id='"+
  lesson+"'");
 assert.match(student,/^[a-f0-9-]{36}$/i);
 assert.match(lesson,/^[a-f0-9-]{36}$/i);
 assert.equal(teacherId,f.actors.teacher.id);
 const beforeV4=db("select count(*) from public.lesson_records where owner_id='"+
  actor.id+"'");
 const beforeSeats=db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'");

 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={environment:'local',isolated:true,projectRef:'local',
   url,publishableKey:key};
 },{url:f.apiUrl,key:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
 await page.evaluate(async({url,key,email,password})=>{
  const supa=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await supa.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic manager editor login failed');
  supa.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-learning-card')).toBeVisible();
 await page.locator('#v5-learning-team-select').selectOption(teamId);
 await expect(page.locator('[data-v5-learning-edit-student="'+student+'"]')).toBeAttached();
 const studentForm=page.locator('[data-v5-learning-edit-student="'+student+'"]');
 await studentForm.locator('input[name="display_name"]').fill('Renamed Team Student GUI');
 await studentForm.locator('button[type="submit"]').click();
 await expect(page.locator('#v5-learning-students')).toContainText('Renamed Team Student GUI');
 assert.equal(db("select display_name from public.v5_team_students where id='"+
  student+"'"),'Renamed Team Student GUI');

 const form=page.locator('[data-v5-learning-edit-lesson="'+lesson+'"]');
 await expect(form).toBeAttached();
 const month=await page.evaluate(()=>{
  const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
 });
 await form.locator('input[name="subject"]').fill('Edited Cross Teacher English');
 await form.locator('input[name="lesson_start"]').fill(month+'-16T14:30');
 await form.locator('input[name="lesson_end"]').fill(month+'-16T15:30');
 await form.locator('textarea[name="notes"]').fill('Authorized schedule edit, teacher unchanged');
 await form.locator('button[type="submit"]').click();
 await expect(page.locator('#v5-learning-lessons')).toContainText('Edited Cross Teacher English');
 assert.equal(db("select subject from public.v5_team_lessons where id='"+
  lesson+"'"),'Edited Cross Teacher English');
 assert.equal(db("select teacher_user_id from public.v5_team_lessons where id='"+
  lesson+"'"),teacherId,
  'Editing time, notes and subject must not reassign lesson teacher');

 page.on('dialog',dialog=>dialog.accept());
 await page.locator('[data-v5-learning-action="archive-student"][data-id="'+student+'"]').click();
 await expect(page.locator('#v5-learning-students')).toContainText('已封存');
 assert.equal(db("select is_archived from public.v5_team_students where id='"+
  student+"'"),'t');
 assert.equal(db("select count(*) from public.v5_team_lessons where student_id='"+
  student+"'"),'2','Archived student must retain both cross-teacher lessons');
 assert.equal(db("select count(*) from tutor_private.v5_team_student_seat_ledger "+
  "where team_id='"+teamId+"'"),beforeSeats,
  'Archiving does not free lifetime student seat');
 assert.equal(db("select count(*) from public.lesson_records where owner_id='"+
  actor.id+"'"),beforeV4,'No V4 personal lessons changed');

 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-learning-card')).toBeHidden();
});
