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

// V5.5: Team panels are deliberately absent in personal mode. Test the
// actual Settings switch before requesting project, lesson or billing access.
async function openTeamSection(page,section){
 assert.ok(['projects','learning','billing'].includes(section));
 await page.locator('#account-action').click();
 const mode=page.locator('#workspace-mode-card [data-workspace-mode="team"]');
 await expect(mode).toBeVisible();
 if(await mode.getAttribute('aria-pressed')!=='true')await mode.click();
 await page.locator('.side-nav .nav-team[data-team-section="'+section+'"]').click();
}
async function signOutFromTeam(page){
 // Login/security controls are on Team's Settings section, not on its ledgers.
 await page.locator('#account-action').click();
 await page.locator('#sign-out').click();
}

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
 await openTeamSection(page,'projects');
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-owner-controls')).toBeVisible();
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Alpha');
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Beta');
 await page.locator('#v5-team-project-name').fill('Project Gamma via GUI');
 await page.locator('#v5-team-project-form button[type="submit"]').click();
 await expect(page.locator('#v5-team-project-list')).toContainText('Project Gamma via GUI');
 await signOutFromTeam(page);
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
 // V5.7 operational finance/reporting must consult CURRENT governance, not a
 // stale JWT. It must never let the old manager continue reading Team metrics.
 const reportTeam=db("select id from public.v5_teams where anchor_workspace_id='"+
  ws+"'");
 const formerReport=await rest(owner,'POST','rpc/v5_team_operations_overview',{
  p_team_id:reportTeam,p_month:'2026-10-01'
 });
 assert.notEqual(formerReport.status,200,'Former manager JWT cannot query Team operations');
 const currentReport=await rest(successor,'POST','rpc/v5_team_operations_overview',{
  p_team_id:reportTeam,p_month:'2026-10-01'
 });
 assert.equal(currentReport.status,200,'Current manager can query Team operations');
 assert.equal(currentReport.data.financial_authority,'manager_only');

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
 await openTeamSection(page,'projects');
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
 await signOutFromTeam(page);
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
 await openTeamSection(page,'learning');
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

 await signOutFromTeam(page);
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
  // Disposable QA only: simulate deliberate new Google-login click.
  await page.evaluate(()=>localStorage.setItem('tutor_v4_explicit_logout','0'));
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/login-required/);
  await openTeamSection(page,'learning');
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

 await signOutFromTeam(page);
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
 await signOutFromTeam(page);
 await expect(page.locator('#v5-learning-card')).toBeHidden();
 await expect(page.locator('#v5-learning-calendar')).toBeEmpty();
});


test('V5.3 manager safely renames Team student, edits lesson, archives without losing history',async({page})=>{
 // Several authenticated GUI edits and refreshes can exceed the 60-second suite default on CI.
 test.setTimeout(120_000);
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
 await openTeamSection(page,'learning');
 await expect(page.locator('#v5-learning-card')).toBeVisible();
 await page.locator('#v5-learning-team-select').selectOption(teamId);
 await expect(page.locator('[data-v5-learning-edit-student="'+student+'"]')).toBeAttached();
 const studentForm=page.locator('[data-v5-learning-edit-student="'+student+'"]');
 await page.locator('#v5-learning-students details.v5-learning-edit > summary').click();
 await studentForm.locator('input[name="display_name"]').fill('Renamed Team Student GUI');
 await studentForm.locator('button[type="submit"]').click();
 await expect(page.locator('#v5-learning-students')).toContainText('Renamed Team Student GUI');
 assert.equal(db("select display_name from public.v5_team_students where id='"+
  student+"'"),'Renamed Team Student GUI');

 const form=page.locator('[data-v5-learning-edit-lesson="'+lesson+'"]');
 await expect(form).toBeAttached();
 await page.locator('[data-v5-lesson-id="'+lesson+'"] details.v5-learning-edit > summary').click();
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

 await signOutFromTeam(page);
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-learning-card')).toBeHidden();
});


test('V5.3 Team fee confirmations are manager-only, immutable and independent of V4',async()=>{
 const manager=await signIn('parent'),teacher=await signIn('teacher'),outsider=await signIn('stranger');
 const m=f.actors.parent.id,t=f.actors.teacher.id;
 const ws=db("select id from public.workspaces where owner_id='"+m+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 const v4before=db("select count(*) from public.lesson_records where owner_id='"+m+"'");
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
  "where workspace_id='"+ws+"'"),m);
 assert.equal(db("select count(*) from public.v5_team_project_members "+
  "where workspace_id='"+ws+"' and project_id='"+project+"' and user_id='"+t+"'"),'1');
 let r=await rest(manager,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'Private Billing Student 01',created_by:m
 });
 assert.equal(r.status,201);
 const student=r.data[0].id;
 r=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:team,project_id:project,student_id:student
 });
 assert.equal(r.status,201);
 const makeLesson=async(user,subject,start,end,status='completed')=>{
  const x=await rest(manager,'POST','v5_team_lessons?select=id',{
   team_id:team,project_id:project,student_id:student,teacher_user_id:user,
   subject,lesson_start:start,lesson_end:end,status
  });
  assert.equal(x.status,201,'Synthetic billing lesson setup');
  return x.data[0].id;
 };
 const a=await makeLesson(m,'數學','2026-10-15T10:00:00+08:00',
  '2026-10-15T11:30:00+08:00');
 const b=await makeLesson(t,'英文','2026-10-16T14:00:00+08:00',
  '2026-10-16T15:20:00+08:00');
 const scheduled=await makeLesson(t,'尚未完成課程','2026-10-17T14:00:00+08:00',
  '2026-10-17T15:00:00+08:00','scheduled');

 const summary=()=>rest(manager,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 r=await summary();
 assert.equal(r.status,200);
 assert.equal(r.data.confirmed_count,0);
 assert.equal(r.data.pending_rows.length,2);
 assert.equal(r.data.confirmed_total_cents,0);
 assert.equal((await rest(teacher,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 })).status,403,'Assigned teacher must not read billing');
 assert.equal((await rest(outsider,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 })).status,403);
 assert.notEqual((await rest(teacher,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:a,p_hourly_rate_cents:65000
 })).status,200,'Assigned teacher cannot confirm finance');
 assert.notEqual((await rest(outsider,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:a,p_hourly_rate_cents:65000
 })).status,200);
 assert.notEqual((await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:scheduled,p_hourly_rate_cents:65000
 })).status,200,'Incomplete lesson must never become confirmed receivable');
 assert.notEqual((await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:a,p_hourly_rate_cents:-1
 })).status,200,'Negative hourly fee is forbidden');

 r=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:a,p_hourly_rate_cents:65000
 });
 assert.equal(r.status,200);
 assert.equal(r.data.amount_cents,97500,'90-minute math: NT$650/hour → NT$975');
 assert.equal(r.data.duration_minutes,90);
 r=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:b,p_hourly_rate_cents:65000
 });
 assert.equal(r.status,200);
 assert.equal(r.data.amount_cents,86667,'80-minute English must round TWD cents');
 assert.notEqual((await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:a,p_hourly_rate_cents:65000
 })).status,200,'Confirmed lesson is at most once');
 r=await summary();
 assert.equal(r.status,200);
 assert.equal(r.data.confirmed_count,2);
 assert.equal(r.data.confirmed_rows.length,2);
 assert.equal(r.data.confirmed_total_cents,184167);
 assert.equal(r.data.pending_rows.length,0);
 assert.deepEqual(new Set(r.data.confirmed_rows.map(x=>x.subject)),
  new Set(['數學','英文']));
 assert.equal(new Set(r.data.confirmed_rows.map(x=>x.teacher_user_id)).size,2);
 assert.deepEqual((await rows(teacher,'v5_team_lessons','&id=eq.'+a)).data
  .map(x=>Object.keys(x).filter(y=>/amount|rate|cents/i.test(y))),[[]],
  'Teacher-readable lesson metadata must never include fee amounts');
 const privateApi=await rows(teacher,'v5_team_lesson_fees');
 assert.notEqual(privateApi.status,200,'Private fee table is not exposed');

 for(const payload of [{lesson_start:'2026-10-15T09:00:00+08:00'},
  {status:'cancelled'},{subject:'操縱已計價科目'}]){
  const x=await rest(manager,'PATCH','v5_team_lessons?id=eq.'+a,payload);
  assert.notEqual(x.status,200,'Billed lesson must be immutable');
 }
 assert.equal(db("select count(*) from tutor_private.v5_team_billing_audit "+
  "where team_id='"+team+"' and event='fee_confirmed'"),'2');
 assert.equal(db("select count(*) from tutor_private.v5_team_lesson_fees "+
  "where team_id='"+team+"'"),'2');
 assert.equal(db("select count(*) from public.lesson_records where owner_id='"+
  m+"'"),v4before,'No V4 lesson write');
});


test('V5.3 Team manager GUI confirms a lesson receivable; regular teachers cannot see fees',async({page})=>{
 const managerJwt=await signIn('parent');
 const m=f.actors.parent,t=f.actors.teacher;
 const ws=db("select id from public.workspaces where owner_id='"+m.id+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 const student=db("select id from public.v5_team_students where team_id='"+
  team+"' and display_name='Private Billing Student 01'");
 let r=await rest(managerJwt,'POST','v5_team_lessons?select=id',{
  team_id:team,project_id:project,student_id:student,teacher_user_id:t.id,
  subject:'Finance UI Synthetic',
  lesson_start:'2026-10-18T13:00:00+08:00',
  lesson_end:'2026-10-18T15:00:00+08:00',status:'completed'
 });
 assert.equal(r.status,201);
 const lesson=r.data[0].id;
 const beforeV4=db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'");

 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url,publishableKey:key
  };
 },{url:f.apiUrl,key:f.anonKey});
 const login=async(role,section='billing')=>{
  const actor=f.actors[role];
  await page.goto('/v2/index.html');
  await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
  await page.evaluate(async({url,key,email,password})=>{
   const s=window.supabase.createClient(url,key,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
   });
   const {error}=await s.auth.signInWithPassword({email,password});
   if(error)throw Error('Synthetic fee UI login failed');
   s.auth.stopAutoRefresh?.();
  },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
  // Disposable QA only: simulate deliberate new Google-login click.
  await page.evaluate(()=>localStorage.setItem('tutor_v4_explicit_logout','0'));
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/login-required/);
  await openTeamSection(page,section);
 };
 await login('parent');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(team);
 await page.locator('#v5-billing-prev').click();
 await expect(page.locator('#v5-billing-pending')).toContainText('Finance UI Synthetic');
 const rate=page.locator('[data-v5-billing-rate-for="'+lesson+'"]');
 await rate.fill('500');
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('[data-v5-billing-action="confirm"][data-id="'+lesson+'"]').click();
 await expect(page.locator('#v5-billing-confirmed')).toContainText('Finance UI Synthetic');
 await expect(page.locator('#v5-billing-total')).toContainText('2,841.67');
 assert.equal(db("select amount_cents from tutor_private.v5_team_lesson_fees "+
  "where lesson_id='"+lesson+"'"),'100000');
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4,'Confirming Team receivable does not receive money or write V4 payments');
 await signOutFromTeam(page);
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-billing-card')).toBeHidden();
 await expect(page.locator('#v5-billing-confirmed')).toBeEmpty();
 await login('teacher','learning');
 await expect(page.locator('#v5-learning-card')).toBeVisible();
 await expect(page.locator('#v5-billing-card')).toBeHidden();
 await signOutFromTeam(page);
 await expect(page.locator('#v5-billing-total')).toBeEmpty();
});


test('V5.3 manual partial payments distribute across subjects without over-allocating',async()=>{
 const manager=await signIn('parent'),teacher=await signIn('teacher');
 const stranger=await signIn('stranger');
 const managerId=f.actors.parent.id;
 const ws=db("select id from public.workspaces where owner_id='"+managerId+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const student=db("select id from public.v5_team_students where team_id='"+
  team+"' and display_name='Private Billing Student 01'");
 const math=db("select lesson_id from tutor_private.v5_team_lesson_fees "+
  "where team_id='"+team+"' and subject='數學'");
 const english=db("select lesson_id from tutor_private.v5_team_lesson_fees "+
  "where team_id='"+team+"' and subject='英文'");
 const gui=db("select lesson_id from tutor_private.v5_team_lesson_fees "+
  "where team_id='"+team+"' and subject='Finance UI Synthetic'");
 assert.match(math,/^[a-f0-9-]{36}$/i);
 assert.match(english,/^[a-f0-9-]{36}$/i);
 assert.match(gui,/^[a-f0-9-]{36}$/i);
 const beforeV4=db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'");
 const report=({reference,studentId=student,amount=60000})=>
  rest(manager,'POST','rpc/v5_report_team_payment',{
   p_team_id:team,p_student_id:studentId,p_amount_cents:amount,
   p_received_on:'2026-10-22',p_method:'bank_transfer',
   p_reference:reference,p_note:'Synthetic no real transfer'
  });
 const allocate=(jwt,paymentId,allocations)=>
  rest(jwt,'POST','rpc/v5_confirm_team_payment_allocation',{
   p_payment_id:paymentId,p_allocations:allocations
  });
 const view=jwt=>rest(jwt,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal((await view(manager)).status,200);
 assert.equal((await view(teacher)).status,403);
 assert.equal((await view(stranger)).status,403);
 assert.notEqual((await rest(teacher,'POST','rpc/v5_report_team_payment',{
  p_team_id:team,p_student_id:student,p_amount_cents:60000,
  p_received_on:'2026-10-22',p_method:'cash',
  p_reference:'NOT-MANAGER-TRY'
 })).status,200);
 assert.notEqual((await report({reference:'WRONG-STUDENT-1',
  studentId:db("select id from public.v5_team_students where team_id<>'"+
   team+"' limit 1")})).status,200,'Cannot report another Team student');
 assert.notEqual((await report({reference:'NEGATIVE-REJECT',amount:-5})).status,200);
 // A separate billing test must not require the previous GUI rename/archive test.
 const unbilled=await rest(manager,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'Unbilled Payment Isolation Student',
  created_by:managerId
 });
 assert.equal(unbilled.status,201,'Create an independent student with no billed courses');
 const unrelatedStudent=unbilled.data[0].id;
 assert.match(unrelatedStudent,/^[a-f0-9-]{36}$/i);
 assert.notEqual((await report({reference:'NO-RECEIVABLE-TEST',
  studentId:unrelatedStudent,amount:100})).status,200,
  'No payment without a confirmed receivable for the same student');
 const first=await report({reference:'PARTIAL-SYNTH-001'});
 assert.equal(first.status,200);
 const paymentId=first.data.payment_id;
 assert.equal(first.data.status,'pending');
 assert.equal((await report({reference:'PARTIAL-SYNTH-001'})).status!==200,true,
  'Reference idempotency must reject duplicate manual report');
 assert.equal((await allocate(teacher,paymentId,[{
  lesson_id:math,amount_cents:60000
 }])).status!==200,true,'Assigned teacher may not confirm payment');
 assert.equal((await allocate(stranger,paymentId,[{
  lesson_id:math,amount_cents:60000
 }])).status!==200,true);
 assert.notEqual((await allocate(manager,paymentId,[{
  lesson_id:math,amount_cents:50000
 }])).status,200,'Must allocate full payment or stay pending');
 assert.notEqual((await allocate(manager,paymentId,[{
  lesson_id:math,amount_cents:60000
 },{lesson_id:math,amount_cents:1}])).status,200,'Duplicate lesson must be rejected');
 assert.notEqual((await allocate(manager,paymentId,[{
  lesson_id:math,amount_cents:60001
 }])).status,200,'Cannot allocate beyond the payment total');
 // Math, English and the existing UI lesson all belong to Student 01.
 // Cross-student and cross-Team restrictions are independently enforced in SQL.
 assert.equal(db("select count(*) from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+paymentId+"'"),'0','Failed allocation must roll back completely');

 let r=await allocate(manager,paymentId,[
  {lesson_id:math,amount_cents:30000},{lesson_id:english,amount_cents:30000}
 ]);
 assert.equal(r.status,200);
 assert.equal(r.data.status,'confirmed');
 assert.equal(r.data.allocated_cents,60000);
 assert.deepEqual(new Set(r.data.allocations.map(x=>x.subject)),new Set(['數學','英文']));
 assert.notEqual((await allocate(manager,paymentId,[{
  lesson_id:math,amount_cents:60000
 }])).status,200,'Payment must be confirmed at most once');
 r=await view(manager);
 assert.equal(r.status,200);
 assert.equal(r.data.confirmed_payments_cents,60000);
 const remaining=Object.fromEntries(r.data.receivables.map(x=>[
  x.lesson_id,x.outstanding_cents
 ]));
 assert.equal(remaining[math],67500);
 assert.equal(remaining[english],56667);
 assert.equal(remaining[gui],100000);
 assert.equal(r.data.payments.find(x=>x.payment_id===paymentId).allocations.length,2);

 const second=await report({reference:'PARTIAL-SYNTH-002',amount:67500});
 assert.equal(second.status,200);
 assert.equal((await allocate(manager,second.data.payment_id,[{
  lesson_id:math,amount_cents:67501
 }])).status!==200,true,'Overpayment must never be hidden as prepayment');
 r=await allocate(manager,second.data.payment_id,[{
  lesson_id:math,amount_cents:67500
 }]);
 assert.equal(r.status,200);
 const third=await report({reference:'PARTIAL-SYNTH-003',amount:56667});
 assert.equal(third.status,200);
 assert.equal((await allocate(manager,third.data.payment_id,[{
  lesson_id:english,amount_cents:56667
 }])).status,200);
 r=await view(manager);
 assert.equal(r.status,200);
 assert.equal(r.data.confirmed_payments_cents,184167);
 assert.equal(r.data.receivables.find(x=>x.lesson_id===math).outstanding_cents,0);
 assert.equal(r.data.receivables.find(x=>x.lesson_id===english).outstanding_cents,0);
 assert.equal(r.data.receivables.find(x=>x.lesson_id===gui).outstanding_cents,100000);
 assert.equal(r.data.outstanding_cents,100000);

 const p4=await report({reference:'PENDING-TRANSFER-4',amount:100});
 assert.equal(p4.status,200);
 const p5=await report({reference:'PENDING-CONCURRENT-5',amount:100});
 assert.equal(p5.status,200);
 const contested=await Promise.all([
  allocate(manager,p4.data.payment_id,[{lesson_id:math,amount_cents:100}]),
  allocate(manager,p5.data.payment_id,[{lesson_id:math,amount_cents:100}])
 ]);
 assert.ok(contested.every(x=>x.status!==200),
  'Concurrent payments cannot over-allocate an already settled receivable');
 assert.equal(db("select count(*) from tutor_private.v5_team_payment_allocations "+
  "where lesson_id='"+math+"'"),'2',
  'Exactly two legitimate partial allocation entries remain');
 assert.equal(db("select count(*) from tutor_private.v5_team_payment_audit "+
  "where team_id='"+team+"' and event='confirmed'"),'3');
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4,'V5 manual payments never write V4 payment history');
 assert.notEqual((await rows(teacher,'v5_team_payment_reports')).status,200);
});


test('V5.3 manager GUI reports and partially allocates a payment without V4 effects',async({page})=>{
 const actor=f.actors.parent;
 const ws=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const student=db("select id from public.v5_team_students where team_id='"+
  team+"' and display_name='Private Billing Student 01'");
 const lesson=db("select lesson_id from tutor_private.v5_team_lesson_fees "+
  "where team_id='"+team+"' and subject='Finance UI Synthetic'");
 const beforeV4=db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'");
 const beforeConfirmed=Number(db(
  "select coalesce(sum(amount_cents),0) from tutor_private.v5_team_payment_reports "+
  "where team_id='"+team+"' and received_on>='2026-10-01' "+
  "and received_on<'2026-11-01' and status='confirmed'"));
 assert.ok(Number.isSafeInteger(beforeConfirmed));
 assert.match(student,/^[a-f0-9-]{36}$/i);
 assert.match(lesson,/^[a-f0-9-]{36}$/i);
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
  if(error)throw Error('Synthetic manager payment GUI login failed');
  supa.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await openTeamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(team);
 await page.locator('#v5-billing-prev').click();
 // V5.7 manager-only operational queue is derived from the same protected
 // billing/payment RPCs; never treat the hint as proof of real bank settlement.
 await expect(page.locator('#v5-operations-card')).toBeVisible();
 await expect(page.locator('#v5-ops-pending-fees')).toHaveText(/^\d+$/);
 await expect(page.locator('#v5-ops-pending-payments')).toHaveText(/^\d+$/);
 await expect(page.locator('#v5-ops-unpaid-lessons')).toHaveText(/^\d+$/);
 await expect(page.locator('#v5-ops-reconciliation')).toContainText('銀行入帳');
 await expect(page.locator('#v5-ops-report-message')).toContainText('管理者');
 await expect(page.locator('#v5-ops-projects')).toContainText('Private Team B Project');
 await expect(page.locator('#v5-ops-teachers')).toContainText('老師');
 const managerJwt=await signIn('parent'),strangerJwt=await signIn('stranger');
 const allowedOps=await rest(managerJwt,'POST','rpc/v5_team_operations_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(allowedOps.status,200);
 assert.equal(allowedOps.data.team_id,team);
 assert.ok(allowedOps.data.projects.some(p=>p.name==='Private Team B Project'));
 assert.equal(allowedOps.data.cash_verified_by_bank,false);
 const deniedOps=await rest(strangerJwt,'POST','rpc/v5_team_operations_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.notEqual(deniedOps.status,200,'Unrelated JWT cannot read manager metrics');

 await expect(page.locator('#v5-payment-student-select')).toHaveValue(student);
 await page.locator('#v5-payment-amount').fill('500');
 await page.locator('#v5-payment-received-date').fill('2026-10-25');
 await page.locator('#v5-payment-method').selectOption('bank_transfer');
 await page.locator('#v5-payment-note').fill('Synthetic manual payment, no external bank');
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('#v5-payment-report-submit').click();
 // The list already contains pending payments for this student from earlier tests.
 // Wait for this newly submitted row, not merely a repeated student name.
 const lookupManualPayment=()=>db("select id from tutor_private.v5_team_payment_reports "+
  "where student_id='"+student+"' and reference like 'manual-%' "+
  "order by reported_at desc limit 1");
 await expect.poll(lookupManualPayment,{timeout:15_000}).toMatch(/^[a-f0-9-]{36}$/i);
 const pid=lookupManualPayment();
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+pid+"'"),'pending');
 const field=page.locator('[data-v5-payment-id="'+pid+'"]'+
  '[data-v5-payment-lesson="'+lesson+'"]');
 await expect(field).toBeVisible();
 await field.fill('500');
 await page.locator('[data-v5-billing-action="allocate-payment"]'+
  '[data-id="'+pid+'"]').click();
 // Likewise, previously confirmed payments are already visible. Assert this
 // particular payment completed before checking the refreshed monthly UI.
 await expect.poll(()=>db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+pid+"'"),{timeout:15_000}).toBe('confirmed');
 await expect(page.locator('#v5-payment-confirmed-reports')).toContainText('Private Billing Student 01');
 const expectedConfirmed=new Intl.NumberFormat('zh-TW',{
  style:'currency',currency:'TWD',minimumFractionDigits:0,maximumFractionDigits:2
 }).format((beforeConfirmed+50000)/100);
 await expect(page.locator('#v5-payment-confirmed-total')).toHaveText(expectedConfirmed);
 assert.equal(Number(db("select coalesce(sum(amount_cents),0) "+
  "from tutor_private.v5_team_payment_reports "+
  "where team_id='"+team+"' and status='confirmed' "+
  "and received_on>='2026-10-01' and received_on<'2026-11-01'")),
  beforeConfirmed+50000,'Confirmed monthly ledger increases by exactly NT$500');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+pid+"'"),'confirmed');
 assert.equal(db("select amount_cents from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+pid+"' and lesson_id='"+lesson+"'"),'50000');
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4,'Manager report/allocate GUI never changes V4 receipts');
 await signOutFromTeam(page);
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-billing-card')).toBeHidden();
 await expect(page.locator('#v5-operations-card')).toBeHidden();
 await expect(page.locator('#v5-ops-pending-fees')).toBeEmpty();
 await expect(page.locator('#v5-ops-projects')).toBeEmpty();
 await expect(page.locator('#v5-ops-teachers')).toBeEmpty();
 await expect(page.locator('#v5-ops-activity')).toBeEmpty();
 await expect(page.locator('#v5-payment-confirmed-reports')).toBeEmpty();
 await expect(page.locator('#v5-payment-pending-reports')).toBeEmpty();
});

test('V5.4 isolated advance credit is split, suggested, applied and never double-settled',async()=>{
 const manager=await signIn('parent'),teacher=await signIn('teacher');
 const stranger=await signIn('stranger'),owner=f.actors.parent.id;
 const ws=db("select id from public.workspaces where owner_id='"+owner+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 assert.match(team,/^[a-f0-9-]{36}$/i);
 const beforeV4Payments=db("select count(*) from public.payment_batches "+
  "where workspace_id='"+ws+"'");
 const beforeV4Lessons=db("select count(*) from public.lesson_records "+
  "where owner_id='"+owner+"'");
 let r=await rest(manager,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'Advance Credit Isolation Student',
  created_by:owner
 });
 assert.equal(r.status,201);
 const student=r.data[0].id;
 r=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:team,project_id:project,student_id:student
 });
 assert.equal(r.status,201);
 const makeFee=async(subject,date,hourly)=>{
  const lesson=await rest(manager,'POST','v5_team_lessons?select=id',{
   team_id:team,project_id:project,student_id:student,
   teacher_user_id:owner,subject,status:'completed',
   lesson_start:date+'T14:00:00+08:00',
   lesson_end:date+'T15:00:00+08:00'
  });
  assert.equal(lesson.status,201,'Create isolated completed course');
  const id=lesson.data[0].id;
  const fee=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
   p_lesson_id:id,p_hourly_rate_cents:hourly
  });
  assert.equal(fee.status,200,'Confirm isolated course fee');
  assert.equal(fee.data.amount_cents,hourly);
  return id;
 };
 const math=await makeFee('Advance Math','2026-10-22',100000);
 const english=await makeFee('Advance English','2026-10-23',50000);
 const science=await makeFee('Advance Science','2026-10-24',80000);
 const monthly=()=>rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 const baseline=await monthly();
 assert.equal(baseline.status,200);
 const initialConfirmed=baseline.data.confirmed_payments_cents;
 const initialAdvanceApplied=baseline.data.advance_applied_cents;
 const initialAdvanceAvailable=baseline.data.advance_available_cents;
 const initialOutstanding=baseline.data.outstanding_cents;
 const initialAdvanceCreated=baseline.data.advance_created_cents;
 const reportArgs={
  p_team_id:team,p_student_id:student,p_amount_cents:160000,
  p_received_on:'2026-10-25',p_method:'bank_transfer',
  p_reference:'ADVANCE-ISOLATED-1600',p_expected_credit_cents:60000,
  p_note:'Synthetic manually verified entry; no real bank transaction'
 };
 assert.notEqual((await rest(teacher,'POST',
  'rpc/v5_report_team_payment_with_advance',reportArgs)).status,200);
 assert.notEqual((await rest(stranger,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:student
 })).status,200);
 r=await rest(manager,'POST','rpc/v5_report_team_payment_with_advance',reportArgs);
 assert.equal(r.status,200,'Manager reports payment with explicit planned credit');
 const payment=r.data.payment_id;
 assert.equal(r.data.expected_credit_cents,60000);
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_report_team_payment_with_advance',reportArgs)).status,200,
  'The same Team payment reference cannot be reported twice');
 // A V5.4 report cannot be confirmed using the older full-payment RPC.
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_confirm_team_payment_allocation',{
  p_payment_id:payment,
  p_allocations:[{lesson_id:math,amount_cents:100000},
   {lesson_id:english,amount_cents:50000},
   {lesson_id:science,amount_cents:10000}]
 })).status,200,'Original V5.3 RPC cannot bypass advance creation');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+payment+"'"),'pending');
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_confirm_team_advance_payment',{
  p_payment_id:payment,
  p_allocations:[{lesson_id:math,amount_cents:90000}]
 })).status,200,'Mismatch between direct allocation and planned credit rolls back');
 assert.equal(db("select count(*) from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+payment+"'"),'0');
 r=await rest(manager,'POST','rpc/v5_confirm_team_advance_payment',{
  p_payment_id:payment,
  p_allocations:[{lesson_id:math,amount_cents:100000}]
 });
 assert.equal(r.status,200);
 assert.equal(r.data.status,'confirmed');
 assert.equal(r.data.allocated_cents,100000);
 assert.equal(r.data.credit_cents,60000);
 const credit=r.data.credit_id;
 assert.match(credit,/^[a-f0-9-]{36}$/i);
 let reconciled=await monthly();
 assert.equal(reconciled.status,200);
 assert.equal(reconciled.data.confirmed_payments_cents,
  initialConfirmed+160000,'An advance payment adds receipt only once');
 assert.equal(reconciled.data.advance_created_cents,initialAdvanceCreated+60000);
 assert.equal(reconciled.data.advance_available_cents,initialAdvanceAvailable+60000);
 assert.equal(reconciled.data.advance_applied_cents,initialAdvanceApplied);
 assert.equal(reconciled.data.outstanding_cents,initialOutstanding-100000);
 assert.equal(reconciled.data.receivables.find(x=>x.lesson_id===math).outstanding_cents,0);
 assert.equal(reconciled.data.payments.find(x=>x.payment_id===payment).advance_credit_cents,
  60000,'Credit is a component of confirmed payment, not another receipt');
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_confirm_team_advance_payment',{
  p_payment_id:payment,p_allocations:[{lesson_id:math,amount_cents:100000}]
 })).status,200,'Payment confirmation is one-time');
 assert.equal(db("select amount_cents from tutor_private.v5_team_advance_credits "+
  "where id='"+credit+"'"),'60000');
 assert.notEqual((await rows(teacher,'v5_team_advance_credits')).status,200,
  'Regular Team teachers cannot fetch private credit balances');
 let overview=await rest(manager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:student
 });
 assert.equal(overview.status,200);
 assert.equal(overview.data.available_cents,60000);
 assert.equal(overview.data.outstanding_cents,130000);
 assert.equal(overview.data.credits.length,1);
 assert.equal(overview.data.credits[0].available_cents,60000);
 assert.equal(overview.data.suggestions.reduce((s,x)=>s+x.suggested_cents,0),
  60000,'Recommendations do not yet write applications');
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_applications "+
  "where credit_id='"+credit+"'"),'0');
 const allocations=[
  {lesson_id:english,amount_cents:40000},
  {lesson_id:science,amount_cents:20000}
 ];
 assert.notEqual((await rest(teacher,'POST',
  'rpc/v5_apply_team_advance_credit',{
   p_credit_id:credit,p_allocations:allocations,
   p_idempotency_key:'ADVANCE-APPLY-ISOLATION-001'
  })).status,200,'A teacher cannot approve advance offsets');
 r=await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:allocations,
  p_idempotency_key:'ADVANCE-APPLY-ISOLATION-001'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.applied_cents,60000);
 assert.equal(r.data.idempotent,false);
 const initialOperation=r.data.operation_id;
 r=await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:allocations,
  p_idempotency_key:'ADVANCE-APPLY-ISOLATION-001'
 });
 assert.equal(r.status,200,'Retry returns original confirmed operation');
 assert.equal(r.data.operation_id,initialOperation);
 assert.equal(r.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:[{lesson_id:english,amount_cents:1}],
  p_idempotency_key:'ADVANCE-APPLY-ISOLATION-001'
 })).status,200,'Reusing idempotency key with changed payload is rejected');
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:[{lesson_id:science,amount_cents:1}],
  p_idempotency_key:'ADVANCE-APPLY-ISOLATION-002'
 })).status,200,'Spent credit cannot be applied again');
 overview=await rest(manager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:student
 });
 assert.equal(overview.status,200);
 assert.equal(overview.data.available_cents,0);
 assert.equal(overview.data.outstanding_cents,70000);
 assert.equal(overview.data.suggestions.length,0);
 reconciled=await monthly();
 assert.equal(reconciled.status,200);
 assert.equal(reconciled.data.confirmed_payments_cents,initialConfirmed+160000,
  'Applying an advance must not increase confirmed receipts again');
 assert.equal(reconciled.data.advance_applied_cents,initialAdvanceApplied+60000);
 assert.equal(reconciled.data.outstanding_cents,initialOutstanding-160000);
 assert.equal(reconciled.data.advance_available_cents,initialAdvanceAvailable);
 const englishMonthly=reconciled.data.receivables.find(x=>x.lesson_id===english);
 assert.equal(englishMonthly.advance_applied_cents,40000);
 assert.equal(englishMonthly.outstanding_cents,10000);
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_operations "+
  "where credit_id='"+credit+"'"),'1');
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_applications "+
  "where credit_id='"+credit+"'"),'2');
 // The older V5.3 confirmation must not double-pay an already offset lesson.
 const legacy=await rest(manager,'POST','rpc/v5_report_team_payment',{
  p_team_id:team,p_student_id:student,p_amount_cents:30000,
  p_received_on:'2026-10-26',p_method:'cash',
  p_reference:'ADVANCE-LEGACY-OVERSETTLE'
 });
 assert.equal(legacy.status,200);
 assert.notEqual((await rest(manager,'POST',
  'rpc/v5_confirm_team_payment_allocation',{
  p_payment_id:legacy.data.payment_id,
  p_allocations:[{lesson_id:english,amount_cents:30000}]
 })).status,200,'Combined-settlement trigger blocks stale V5.3 amount');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+legacy.data.payment_id+"'"),'pending');
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_audit "+
  "where credit_id='"+credit+"'"),'2','Creation and one apply audit remain immutable');
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4Payments,'V4 receipts must remain unchanged');
 assert.equal(db("select count(*) from public.lesson_records where owner_id='"+
  owner+"'"),beforeV4Lessons,'V4 lessons must remain unchanged');
});

test('V5.4 concurrent advance offsets cannot spend the same credit twice',async()=>{
 const manager=await signIn('parent');
 const m=f.actors.parent.id;
 const ws=db("select id from public.workspaces where owner_id='"+m+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 const makeStudentWithFee=async(name,subject,day)=>{
  let response=await rest(manager,'POST','v5_team_students?select=id',{
   team_id:team,display_name:name,created_by:m
  });
  assert.equal(response.status,201);
  const student=response.data[0].id;
  response=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
   team_id:team,project_id:project,student_id:student
  });
  assert.equal(response.status,201);
  response=await rest(manager,'POST','v5_team_lessons?select=id',{
   team_id:team,project_id:project,student_id:student,teacher_user_id:m,
   subject,status:'completed',
   lesson_start:'2026-10-'+day+'T11:00:00+08:00',
   lesson_end:'2026-10-'+day+'T12:00:00+08:00'
  });
  assert.equal(response.status,201);
  const lesson=response.data[0].id;
  response=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
   p_lesson_id:lesson,p_hourly_rate_cents:10000
  });
  assert.equal(response.status,200);
  return {student,lesson};
 };
 const current=await makeStudentWithFee(
  'Concurrency Advance Student 01','Concurrency Math','29');
 const other=await makeStudentWithFee(
  'Concurrency Advance Student 02','Concurrency English','30');
 const beforeV4=db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'");
 let result=await rest(manager,'POST','rpc/v5_report_team_payment_with_advance',{
  p_team_id:team,p_student_id:current.student,p_amount_cents:6000,
  p_expected_credit_cents:6000,p_received_on:'2026-10-30',
  p_method:'cash',p_reference:'CONCURRENT-ADVANCE-ISOLATION-001'
 });
 assert.equal(result.status,200);
 result=await rest(manager,'POST','rpc/v5_confirm_team_advance_payment',{
  p_payment_id:result.data.payment_id,p_allocations:[]
 });
 assert.equal(result.status,200);
 const credit=result.data.credit_id;
 // This fails for the student's identity, even while the credit is available.
 const cross=await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_idempotency_key:'CONCURRENT-WRONG-STUDENT',
  p_allocations:[{lesson_id:other.lesson,amount_cents:1000}]
 });
 assert.equal(cross.status,403,'A credit cannot pay another student in the same Team');
 const attempt=key=>rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_idempotency_key:key,
  p_allocations:[{lesson_id:current.lesson,amount_cents:6000}]
 });
 const both=await Promise.all([
  attempt('CONCURRENT-ADVANCE-WRITER-A'),
  attempt('CONCURRENT-ADVANCE-WRITER-B')
 ]);
 assert.equal(both.filter(x=>x.status===200).length,1,
  'Two simultaneous writers must not both spend the same advance');
 assert.equal(both.filter(x=>x.status!==200).length,1);
 const balance=await rest(manager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:current.student
 });
 assert.equal(balance.status,200);
 assert.equal(balance.data.available_cents,0);
 assert.equal(balance.data.outstanding_cents,4000);
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_operations "+
  "where credit_id='"+credit+"'"),'1','Only one operation is committed');
 assert.equal(db("select coalesce(sum(amount_cents),0) "+
  "from tutor_private.v5_team_advance_applications "+
  "where credit_id='"+credit+"'"),'6000','Exactly one credit consumption');
 assert.equal(db("select count(*) from tutor_private.v5_team_advance_audit "+
  "where credit_id='"+credit+"' and event='credit_applied'"),'1',
  'Only one append-only application audit');
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4,'No V4 receipt changes during concurrent credit application');
});

test('V5.4 month boundaries count October cash once and September advance settlement only',async()=>{
 const actor=f.actors.parent,manager=await signIn('parent');
 const ws=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 let r=await rest(manager,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'Cross Month Advance Isolation Student',
  created_by:actor.id
 });
 assert.equal(r.status,201);
 const student=r.data[0].id;
 r=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:team,project_id:project,student_id:student
 });
 assert.equal(r.status,201);
 const create=async(date,subject,hourly)=>{
  let resp=await rest(manager,'POST','v5_team_lessons?select=id',{
   team_id:team,project_id:project,student_id:student,
   teacher_user_id:actor.id,subject,status:'completed',
   lesson_start:date+'T13:00:00+08:00',
   lesson_end:date+'T14:00:00+08:00'
  });
  assert.equal(resp.status,201);
  const id=resp.data[0].id;
  resp=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
   p_lesson_id:id,p_hourly_rate_cents:hourly
  });
  assert.equal(resp.status,200);
  return id;
 };
 const september=await create('2026-09-18','Cross Month Math',50000);
 const october=await create('2026-10-19','Cross Month English',100000);
 const monthly=m=>rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:m
 });
 const beforeSept=await monthly('2026-09-01');
 const beforeOct=await monthly('2026-10-01');
 assert.equal(beforeSept.status,200);
 assert.equal(beforeOct.status,200);
 const entry=await rest(manager,'POST','rpc/v5_report_team_payment_with_advance',{
  p_team_id:team,p_student_id:student,
  p_amount_cents:60000,p_expected_credit_cents:20000,
  p_received_on:'2026-10-20',p_method:'cash',
  p_reference:'CROSS-MONTH-ADVANCE-ISOLATED'
 });
 assert.equal(entry.status,200);
 r=await rest(manager,'POST','rpc/v5_confirm_team_advance_payment',{
  p_payment_id:entry.data.payment_id,
  p_allocations:[{lesson_id:october,amount_cents:40000}]
 });
 assert.equal(r.status,200);
 const credit=r.data.credit_id;
 let sep=await monthly('2026-09-01'),oct=await monthly('2026-10-01');
 assert.equal(sep.data.confirmed_payments_cents,
  beforeSept.data.confirmed_payments_cents,'October cash is not a September receipt');
 assert.equal(oct.data.confirmed_payments_cents,
  beforeOct.data.confirmed_payments_cents+60000);
 assert.equal(oct.data.advance_created_cents,beforeOct.data.advance_created_cents+20000);
 assert.equal(oct.data.receivables.find(x=>x.lesson_id===october).outstanding_cents,
  60000);
 r=await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_idempotency_key:'CROSS-MONTH-APPLY-SEPTEMBER',
  p_allocations:[{lesson_id:september,amount_cents:20000}]
 });
 assert.equal(r.status,200);
 sep=await monthly('2026-09-01');oct=await monthly('2026-10-01');
 assert.equal(sep.data.confirmed_payments_cents,
  beforeSept.data.confirmed_payments_cents,
  'September offset must not create a second cash receipt');
 assert.equal(sep.data.advance_applied_cents,beforeSept.data.advance_applied_cents+20000);
 assert.equal(sep.data.outstanding_cents,beforeSept.data.outstanding_cents-20000);
 assert.equal(sep.data.receivables.find(x=>x.lesson_id===september).outstanding_cents,
  30000);
 assert.equal(oct.data.confirmed_payments_cents,
  beforeOct.data.confirmed_payments_cents+60000,
  'October received cash must not increase a second time');
 assert.equal(oct.data.receivables.find(x=>x.lesson_id===october).outstanding_cents,
  60000);
 assert.equal(oct.data.advance_available_cents,beforeOct.data.advance_available_cents);
});

test('V5.4 manager GUI confirms an advance and applies a separate offset with no V4 writes',async({page})=>{
 test.setTimeout(120_000);
 const actor=f.actors.parent,manager=await signIn('parent');
 const ws=db("select id from public.workspaces where owner_id='"+actor.id+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 const beforeV4=db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'");
 let r=await rest(manager,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'GUI Advance Isolated Student',created_by:actor.id
 });
 assert.equal(r.status,201);
 const student=r.data[0].id;
 r=await rest(manager,'POST','v5_team_enrollments?select=student_id',{
  team_id:team,project_id:project,student_id:student
 });
 assert.equal(r.status,201);
 const fee=async(subject,date,hourly)=>{
  let t=await rest(manager,'POST','v5_team_lessons?select=id',{
   team_id:team,project_id:project,student_id:student,teacher_user_id:actor.id,
   subject,lesson_start:date+'T14:00:00+08:00',
   lesson_end:date+'T15:00:00+08:00',status:'completed'
  });
  assert.equal(t.status,201);
  const id=t.data[0].id;
  t=await rest(manager,'POST','rpc/v5_confirm_team_lesson_fee',{
   p_lesson_id:id,p_hourly_rate_cents:hourly
  });
  assert.equal(t.status,200);
  return id;
 };
 const math=await fee('Advance GUI Math','2026-10-27',100000);
 const english=await fee('Advance GUI English','2026-10-28',50000);
 const moneyBefore=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(moneyBefore.status,200);
 const baseReceived=moneyBefore.data.confirmed_payments_cents;
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
  const client=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic advance GUI login failed');
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await openTeamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(team);
 await page.locator('#v5-billing-prev').click();
 await expect(page.locator('#v5-advance-panel')).toBeVisible();
 await expect(page.locator('#v5-advance-student-select option[value="'+student+'"]')).toBeAttached();
 await page.locator('#v5-advance-student-select').selectOption(student);
 await expect(page.locator('#v5-advance-panel')).toBeVisible();
 await expect(page.locator('#v5-advance-student-select')).toHaveValue(student);
 await expect(page.locator('#v5-advance-message')).toContainText('管理者資料已核對');
 await page.locator('#v5-advance-amount').fill('1000');
 await page.locator('#v5-advance-credit').fill('300');
 await page.locator('#v5-advance-received-date').fill('2026-10-29');
 await page.locator('#v5-advance-note').fill('Synthetic GUI advance, no bank verification');
 page.on('dialog',dialog=>dialog.accept());
 await page.locator('#v5-advance-report-submit').click();
 const manualId=()=>db("select id from tutor_private.v5_team_payment_reports "+
  "where student_id='"+student+"' and reference like 'manual-advance-%' "+
  "order by reported_at desc limit 1");
 await expect.poll(manualId,{timeout:20_000}).toMatch(/^[a-f0-9-]{36}$/i);
 const payment=manualId();
 const field=page.locator('[data-v5-advance-payment="'+payment+'"]'+
  '[data-v5-advance-lesson="'+math+'"]');
 await expect(field).toBeVisible();
 await field.fill('700');
 await page.locator('[data-v5-billing-action="confirm-advance-payment"]'+
  '[data-id="'+payment+'"]').click();
 await expect.poll(()=>db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+payment+"'"),{timeout:20_000}).toBe('confirmed');
 const credit=db("select id from tutor_private.v5_team_advance_credits "+
  "where payment_id='"+payment+"'");
 assert.match(credit,/^[a-f0-9-]{36}$/i);
 assert.equal(db("select amount_cents from tutor_private.v5_team_advance_credits "+
  "where id='"+credit+"'"),'30000');
 assert.equal(db("select amount_cents from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+payment+"' and lesson_id='"+math+"'"),'70000');
 await expect(page.locator('#v5-advance-available')).toContainText('300');
 const apply=page.locator('[data-v5-billing-action="apply-advance-credit"]'+
  '[data-id="'+credit+'"]');
 await expect(apply).toBeVisible();
 const suggested=page.locator('[data-v5-advance-credit="'+credit+'"]'+
  '[data-v5-advance-lesson="'+math+'"]');
 await expect(suggested).toHaveValue('300.00');
 await apply.click();
 await expect.poll(()=>db("select coalesce(sum(amount_cents),0) "+
  "from tutor_private.v5_team_advance_applications "+
  "where credit_id='"+credit+"'"),{timeout:20_000}).toBe('30000');
 await expect(page.locator('#v5-advance-available')).toContainText('$0');
 const final=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(final.status,200);
 assert.equal(final.data.confirmed_payments_cents,baseReceived+100000,
  'Advance GUI must count cash exactly once even after offset');
 assert.equal(final.data.receivables.find(x=>x.lesson_id===math).outstanding_cents,0);
 assert.equal(final.data.receivables.find(x=>x.lesson_id===english).outstanding_cents,50000);
 assert.equal(db("select count(*) from public.payment_batches where workspace_id='"+
  ws+"'"),beforeV4,'GUI advance never writes V4 receipts');
 await signOutFromTeam(page);
 await expect(page.locator('body')).toHaveClass(/login-required/);
 await expect(page.locator('#v5-advance-panel')).toBeHidden();
 await expect(page.locator('#v5-advance-available')).toBeEmpty();
 await expect(page.locator('#v5-advance-student-select option')).toHaveCount(0);
 await expect(page.locator('#v5-payment-student-select option')).toHaveCount(0);
 await expect(page.locator('#v5-advance-amount')).toHaveValue('');
});

test('V5.3 billing management follows accepted Team governance transfer, not V4 owner',async()=>{
 const former=await signIn('parent'),newManager=await signIn('teacher');
 const fromId=f.actors.parent.id,toId=f.actors.teacher.id;
 const ws=db("select id from public.workspaces where owner_id='"+fromId+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 // Prepare transfer-specific funds and a pending payment. No dependency on a
 // preceding GUI payment or partial-allocation test succeeding.
 const project=db("select id from public.v5_team_projects where workspace_id='"+
  ws+"' and name='Private Team B Project'");
 assert.match(project,/^[a-f0-9-]{36}$/i);
 let setup=await rest(former,'POST','v5_team_students?select=id',{
  team_id:team,display_name:'Transfer Payment Isolation Student',created_by:fromId
 });
 assert.equal(setup.status,201);
 const freshStudent=setup.data[0].id;
 setup=await rest(former,'POST','v5_team_enrollments?select=student_id',{
  team_id:team,project_id:project,student_id:freshStudent
 });
 assert.equal(setup.status,201);
 setup=await rest(former,'POST','v5_team_lessons?select=id',{
  team_id:team,project_id:project,student_id:freshStudent,teacher_user_id:fromId,
  subject:'Transfer Payment Isolation',lesson_start:'2026-10-20T14:00:00+08:00',
  lesson_end:'2026-10-20T15:00:00+08:00',status:'completed'
 });
 assert.equal(setup.status,201);
 const freshLesson=setup.data[0].id;
 setup=await rest(former,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:freshLesson,p_hourly_rate_cents:65000
 });
 assert.equal(setup.status,200);
 const reportForTransfer=(ref,amount)=>rest(former,'POST','rpc/v5_report_team_payment',{
  p_team_id:team,p_student_id:freshStudent,p_amount_cents:amount,
  p_received_on:'2026-10-26',p_method:'cash',p_reference:ref
 });
 setup=await reportForTransfer('TRANSFER-CONFIRMED-ISOLATED',20000);
 assert.equal(setup.status,200);
 const transferPaid=setup.data.payment_id;
 setup=await rest(former,'POST','rpc/v5_confirm_team_payment_allocation',{
  p_payment_id:transferPaid,
  p_allocations:[{lesson_id:freshLesson,amount_cents:20000}]
 });
 assert.equal(setup.status,200);
 setup=await reportForTransfer('PENDING-TRANSFER-ISOLATED',100);
 assert.equal(setup.status,200);
 const pending=setup.data.payment_id;
 // The same governance transfer must revoke V5.4 credit read/write with the
 // old JWT, while preserving an already confirmed credit for the new manager.
 let transferAdvance=await rest(former,'POST',
  'rpc/v5_report_team_payment_with_advance',{
   p_team_id:team,p_student_id:freshStudent,p_amount_cents:100,
   p_expected_credit_cents:100,p_received_on:'2026-10-26',
   p_method:'cash',p_reference:'TRANSFER-ADVANCE-ISOLATION'
  });
 assert.equal(transferAdvance.status,200);
 transferAdvance=await rest(former,'POST','rpc/v5_confirm_team_advance_payment',{
  p_payment_id:transferAdvance.data.payment_id,p_allocations:[]
 });
 assert.equal(transferAdvance.status,200);
 const transferCredit=transferAdvance.data.credit_id;
 const auditBefore=db("select count(*) from tutor_private.v5_team_billing_audit "+
  "where team_id='"+team+"'");
 const feesBefore=await rest(former,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(feesBefore.status,200);
 const beforeTransfer=await rest(former,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(beforeTransfer.status,200);
 assert.ok(beforeTransfer.data.confirmed_payments_cents>0,
  'A previous confirmed payment must exist before authority transfer');
 const nominate=await rest(former,'POST','rpc/v5_propose_team_manager',{
  p_workspace_id:ws,p_target_user_id:toId
 });
 assert.equal(nominate.status,200);
 let r=await rest(newManager,'POST','rpc/v5_respond_team_manager',{
  p_transfer_id:nominate.data,p_accept:true
 });
 assert.equal(r.status,200);
 assert.equal(r.data.status,'accepted');
 assert.equal(db("select owner_id from public.workspaces where id='"+ws+"'"),fromId,
  'V4 owner remains the original user');
 const newView=await rest(newManager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(newView.status,200,'New Team manager inherits payment read authority');
 assert.equal(newView.data.confirmed_payments_cents,
  beforeTransfer.data.confirmed_payments_cents,
  'Team governance transfer must preserve all confirmed payment totals');
 assert.deepEqual(newView.data.payments,beforeTransfer.data.payments,
  'Existing payment history must survive manager transfer unchanged');
 const oldView=await rest(former,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(oldView.status,403,'Previous manager immediately loses payment records');
 const inheritedCredit=await rest(newManager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:freshStudent
 });
 assert.equal(inheritedCredit.status,200);
 assert.ok(inheritedCredit.data.credits.some(c=>c.credit_id===transferCredit));
 assert.equal((await rest(former,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:freshStudent
 })).status,403,'Previous manager loses advance credit read authority');
 assert.notEqual((await rest(former,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:transferCredit,
  p_allocations:[{lesson_id:freshLesson,amount_cents:100}],
  p_idempotency_key:'TRANSFER-OLD-MANAGER-BLOCKED'
 })).status,200,'Previous manager cannot offset any credit with an old JWT');
 assert.notEqual((await rest(former,'POST','rpc/v5_report_team_payment_with_advance',{
  p_team_id:team,p_student_id:freshStudent,p_amount_cents:100,
  p_expected_credit_cents:100,p_received_on:'2026-10-26',
  p_method:'cash',p_reference:'TRANSFER-FORMER-BLOCKED'
 })).status,200,'Previous manager cannot create advance credit');
 assert.notEqual((await rest(former,'POST','rpc/v5_report_team_payment',{
  p_team_id:team,p_student_id:newView.data.receivables[0].student_id,
  p_amount_cents:100,p_received_on:'2026-10-26',
  p_method:'cash',p_reference:'OLD-MANAGER-FORBIDDEN'
 })).status,200,'Former manager cannot report a new payment');
 assert.match(pending,/^[a-f0-9-]{36}$/i);
 assert.notEqual((await rest(former,'POST','rpc/v5_confirm_team_payment_allocation',{
  p_payment_id:pending,
  p_allocations:[{lesson_id:freshLesson,amount_cents:100}]
 })).status,200,'Former manager cannot confirm allocations after transfer');
 r=await rest(newManager,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.confirmed_total_cents,feesBefore.data.confirmed_total_cents,
  'Transfer cannot change confirmed lesson fees');
 r=await rest(former,'POST','rpc/v5_team_billing_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(r.status,403,'Former manager immediately loses finance with old JWT');
 assert.notEqual((await rest(former,'POST','rpc/v5_confirm_team_lesson_fee',{
  p_lesson_id:r.data?.lesson_id||'00000000-0000-0000-0000-000000000001',
  p_hourly_rate_cents:50000
 })).status,200,'Former manager cannot post finance after transfer');
 assert.equal(db("select count(*) from tutor_private.v5_team_billing_audit "+
  "where team_id='"+team+"'"),auditBefore,'Transfer does not modify audit or fees');
});


test('V5.6 append-only pending void, metadata correction and unused-credit refund are manager-only',async()=>{
 // This test intentionally follows the governance-transfer case above.
 // It uses only disposable synthetic Team B, no Production or real payments.
 const manager=await signIn('teacher');
 const former=await signIn('parent');
 const stranger=await signIn('stranger');
 const studentActor=await signIn('student');
 const fromId=f.actors.parent.id,toId=f.actors.teacher.id;
 const ws=db("select id from public.workspaces where owner_id='"+fromId+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 assert.equal(db("select manager_user_id from public.v5_team_governance "+
   "where workspace_id='"+ws+"'"),toId,'Team B manager transferred in previous test');
 const credit=db("select c.id from tutor_private.v5_team_advance_credits c "+
  "join tutor_private.v5_team_payment_reports p on p.id=c.payment_id "+
  "where p.team_id='"+team+"' and p.reference='TRANSFER-ADVANCE-ISOLATION'");
 const pending=db("select id from tutor_private.v5_team_payment_reports "+
  "where team_id='"+team+"' and reference='PENDING-TRANSFER-ISOLATED'");
 const confirmed=db("select id from tutor_private.v5_team_payment_reports "+
  "where team_id='"+team+"' and reference='TRANSFER-CONFIRMED-ISOLATED'");
 const lesson=db("select f.lesson_id from tutor_private.v5_team_lesson_fees f "+
  "join public.v5_team_lessons l on l.id=f.lesson_id "+
  "where f.team_id='"+team+"' and l.subject='Transfer Payment Isolation'");
 assert.match(credit,/^[a-f0-9-]{36}$/i);
 assert.match(pending,/^[a-f0-9-]{36}$/i);
 assert.match(confirmed,/^[a-f0-9-]{36}$/i);
 assert.match(lesson,/^[a-f0-9-]{36}$/i);
 const beforeV4=db("select count(*) from public.payment_batches");
 const initialCredit=db("select amount_cents from tutor_private.v5_team_advance_credits where id='"+credit+"'");
 assert.equal(initialCredit,'100');
 // Metadata does not prove tenant authority: every RPC rechecks manager.
 const voidArgs={p_payment_id:pending,
  p_idempotency_key:'V56-PENDING-VOID-001',
  p_reason:'Synthetic pending void test, not a real transfer'};
 assert.equal((await rest(former,'POST','rpc/v56_void_team_pending_payment',voidArgs)).status,403);
 assert.equal((await rest(stranger,'POST','rpc/v56_void_team_pending_payment',voidArgs)).status,403);
 let r=await rest(manager,'POST','rpc/v56_void_team_pending_payment',voidArgs);
 assert.equal(r.status,200);
 assert.equal(r.data.status,'void');
 assert.equal(r.data.idempotent,false);
 r=await rest(manager,'POST','rpc/v56_void_team_pending_payment',voidArgs);
 assert.equal(r.status,200);
 assert.equal(r.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_void_team_pending_payment',{
  ...voidArgs,p_idempotency_key:'V56-CONFLICT-VOID-001'
 })).status,200);
 assert.notEqual((await rest(manager,'POST','rpc/v5_confirm_team_payment_allocation',{
  p_payment_id:pending,p_allocations:[{lesson_id:lesson,amount_cents:100}]
 })).status,200,'Voided pending payment must not confirm');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+pending+"'"),'pending','Original reported row remains immutable');
 let month=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(month.status,200);
 assert.equal(month.data.payments.find(p=>p.payment_id===pending).status,'void');
 const originalNote=db("select note from tutor_private.v5_team_payment_reports "+
  "where id='"+confirmed+"'");
 const correction={p_payment_id:confirmed,p_field:'note',
  p_new_value:'Synthetic corrected note, historical original retained',
  p_reason:'V5.6 synthetic operator correction audit',
  p_idempotency_key:'V56-METADATA-FIX-001'};
 assert.equal((await rest(former,'POST','rpc/v56_correct_team_payment_metadata',
  correction)).status,403);
 r=await rest(manager,'POST','rpc/v56_correct_team_payment_metadata',correction);
 assert.equal(r.status,200);
 assert.equal(r.data.idempotent,false);
 const correctionId=r.data.correction_id;
 r=await rest(manager,'POST','rpc/v56_correct_team_payment_metadata',correction);
 assert.equal(r.status,200);
 assert.equal(r.data.correction_id,correctionId);
 assert.equal(r.data.idempotent,true);
 assert.equal(db("select note from tutor_private.v5_team_payment_reports "+
  "where id='"+confirmed+"'"),originalNote,'Original confirmed payment untouched');
 assert.notEqual((await rest(manager,'POST','rpc/v56_correct_team_payment_metadata',{
  ...correction,p_new_value:'Different text'
 })).status,200,'Same idempotency key cannot change correction payload');
 // V5.6 P0 first tranche: request a reversal of an already confirmed
 // direct allocation. Intake must NOT change settlement before approval.
 const beforeDirect=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(beforeDirect.status,200);
 const directRequest={
  p_payment_id:confirmed,
  p_allocations:[{lesson_id:lesson,amount_cents:5000}],
  p_idempotency_key:'V56-DIRECT-INTAKE-001',
  p_reason:'Synthetic refund intake pending financial approval'
 };
 assert.equal((await rest(former,'POST','rpc/v56_request_team_direct_refund',
  directRequest)).status,403,'Former Team manager cannot request direct refund');
 assert.equal((await rest(stranger,'POST','rpc/v56_request_team_direct_refund',
  directRequest)).status,403,'Other tenant cannot request direct refund');
 assert.equal((await rest(studentActor,'POST','rpc/v56_request_team_direct_refund',
  directRequest)).status,403,'Student cannot request direct refund');
 let direct=await rest(manager,'POST','rpc/v56_request_team_direct_refund',
  directRequest);
 assert.equal(direct.status,200);
 assert.equal(direct.data.status,'requested_no_settlement');
 assert.equal(direct.data.amount_cents,5000);
 assert.equal(direct.data.settlement_changed,false);
 assert.equal(direct.data.bank_verified,false);
 const directId=direct.data.request_id;
 direct=await rest(manager,'POST','rpc/v56_request_team_direct_refund',directRequest);
 assert.equal(direct.status,200);
 assert.equal(direct.data.request_id,directId);
 assert.equal(direct.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_request_team_direct_refund',{
  ...directRequest,p_allocations:[{lesson_id:lesson,amount_cents:4500}]
 })).status,200,'Request idempotency cannot be reused with changed amount');
 assert.notEqual((await rest(manager,'POST','rpc/v56_request_team_direct_refund',{
  ...directRequest,p_idempotency_key:'V56-DIRECT-EXCESS-001',
  p_allocations:[{lesson_id:lesson,amount_cents:20001}]
 })).status,200,'Cannot request more than the original direct allocation');
 assert.notEqual((await rest(manager,'POST','rpc/v56_request_team_direct_refund',{
  ...directRequest,p_idempotency_key:'V56-DIRECT-DUPLICATE-001',
  p_allocations:[{lesson_id:lesson,amount_cents:500},
   {lesson_id:lesson,amount_cents:500}]
 })).status,200,'Duplicate course allocation cannot be requested');
 assert.equal(db("select amount_cents from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+confirmed+"' and lesson_id='"+lesson+"'"),'20000',
  'Immutable direct allocation remains intact');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports "+
  "where id='"+confirmed+"'"),'confirmed','Confirmed payment remains immutable');
 const afterDirect=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(afterDirect.status,200);
 for(const k of ['outstanding_cents','confirmed_payments_cents',
  'direct_allocated_cents','net_cash_movement_cents'])
  assert.equal(afterDirect.data[k],beforeDirect.data[k],
   'Request-only intake must not change financial settlement '+k);
 const requestMonth=db("select to_char(now() at time zone 'Asia/Taipei','YYYY-MM-01')");
 const directOverview=await rest(manager,'POST',
  'rpc/v56_team_direct_refund_intake_overview',{
   p_team_id:team,p_month:requestMonth
  });
 assert.equal(directOverview.status,200);
 assert.ok(directOverview.data.requests.some(x=>
  x.request_id===directId && x.status==='requested_no_settlement'));
 assert.equal((await rest(former,'POST',
  'rpc/v56_team_direct_refund_intake_overview',{
   p_team_id:team,p_month:requestMonth
  })).status,403,'Former manager cannot view refund requests');
 assert.notEqual((await rows(studentActor,'v56_team_direct_refund_intake')).status,200,
  'Private intake table must never be exposed directly');

 // Approved allocated refunds reopen NET receivables; never mark a bank payout.
 const netArgs={p_team_id:team,p_month:'2026-10-01'};
 const netBeforeDirect=await rest(manager,'POST','rpc/v56_team_direct_refund_net_overview',netArgs);
 assert.equal(netBeforeDirect.status,200,JSON.stringify(netBeforeDirect.data));
 const decisionReason='Synthetic direct refund approval with no bank payout';
 const decision={p_request_id:directId,p_approve:true,p_reason:decisionReason};
 assert.equal((await rest(former,'POST','rpc/v56_decide_team_direct_refund',decision)).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_decide_team_direct_refund',decision)).status,403);
 assert.equal((await rest(stranger,'POST','rpc/v56_decide_team_direct_refund',decision)).status,403);
 assert.equal((await rest(former,'POST','rpc/v56_team_direct_refund_net_overview',netArgs)).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_team_direct_refund_net_overview',netArgs)).status,403);
 let decided=await rest(manager,'POST','rpc/v56_decide_team_direct_refund',decision);
 assert.equal(decided.status,200,JSON.stringify(decided.data));
 assert.equal(decided.data.status,'approved_reversed_pending_manual_payout');
 assert.equal(decided.data.settlement_changed,true);
 assert.equal(decided.data.bank_verified,false);
 assert.equal(decided.data.manual_paid,false);
 decided=await rest(manager,'POST','rpc/v56_decide_team_direct_refund',decision);
 assert.equal(decided.status,200);
 assert.equal(decided.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_decide_team_direct_refund',{
  ...decision,p_approve:false
 })).status,200,'Cannot change decision after approval');
 assert.notEqual((await rest(manager,'POST','rpc/v56_decide_team_direct_refund',{
  ...decision,p_reason:'Changed decision reasons are not allowed'
 })).status,200,'Cannot rewrite immutable decision reason');
 assert.equal(db("select amount_cents from tutor_private.v5_team_payment_allocations "+
  "where payment_id='"+confirmed+"' and lesson_id='"+lesson+"'"),'20000');
 assert.equal(db("select coalesce(sum(amount_cents),0) from tutor_private.v56_team_direct_refund_reversals "+
  "where payment_id='"+confirmed+"'"),'5000');
 const netAfterDirect=await rest(manager,'POST','rpc/v56_team_direct_refund_net_overview',netArgs);
 assert.equal(netAfterDirect.status,200);
 assert.equal(netAfterDirect.data.outstanding_cents,
  netBeforeDirect.data.outstanding_cents+5000,'Refund reversal reopens course receivable');
 assert.equal(netAfterDirect.data.direct_net_allocated_cents,
  netBeforeDirect.data.direct_net_allocated_cents-5000);
 assert.equal(netAfterDirect.data.all_time_direct_refund_liability_cents,
  netBeforeDirect.data.all_time_direct_refund_liability_cents+5000);
 assert.equal(netAfterDirect.data.all_time_confirmed_receipts_cents,
  netBeforeDirect.data.all_time_confirmed_receipts_cents,'No cash leaves on approval');
 assert.equal(netAfterDirect.data.physical_bank_refund_verified,false);
 // V5.7 project operations must use the same NET financial basis as V5.6.
 const projectOperations=await rest(manager,'POST','rpc/v5_team_operations_overview',netArgs);
 const netPaymentOverview=await rest(manager,'POST','rpc/v5_team_payment_overview',netArgs);
 assert.equal(projectOperations.status,200,JSON.stringify(projectOperations.data));
 assert.equal(netPaymentOverview.status,200,JSON.stringify(netPaymentOverview.data));
 assert.equal(projectOperations.data.ledger_basis,'net_after_immutable_reversals');
 assert.equal(projectOperations.data.cash_verified_by_bank,false);
 const projectRows=projectOperations.data.projects;
 assert.ok(projectRows.length>0);
 assert.equal(projectRows.reduce((n,p)=>n+p.outstanding_cents,0),
  netPaymentOverview.data.outstanding_cents,
  'V5.7 per-project outstanding must equal the net V5.6 Team balance');
 assert.equal(projectRows.reduce((n,p)=>n+p.direct_net_cents,0),
  netPaymentOverview.data.direct_allocated_cents);
 assert.equal(projectRows.reduce((n,p)=>n+p.advance_net_cents,0),
  netPaymentOverview.data.advance_applied_cents);
 for(const row of projectRows)
  assert.equal(row.confirmed_receivable_cents,
   row.direct_net_cents+row.advance_net_cents+row.outstanding_cents,
   'Each project must conserve its financial balance after direct refunds');
 assert.equal((await rest(former,'POST','rpc/v5_team_operations_overview',netArgs)).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v5_team_operations_overview',netArgs)).status,403);
 // A rejected request never inserts a reversal.
 const rejectRequest={...directRequest,p_idempotency_key:'V56-DIRECT-REJECT-001',
  p_allocations:[{lesson_id:lesson,amount_cents:100}]};
 const rejection=await rest(manager,'POST','rpc/v56_request_team_direct_refund',rejectRequest);
 assert.equal(rejection.status,200);
 decided=await rest(manager,'POST','rpc/v56_decide_team_direct_refund',{
  p_request_id:rejection.data.request_id,p_approve:false,
  p_reason:'Synthetic manager rejects this duplicate adjustment'
 });
 assert.equal(decided.status,200);
 assert.equal(decided.data.status,'rejected');
 assert.equal(decided.data.settlement_changed,false);
 assert.equal(db("select count(*) from tutor_private.v56_team_direct_refund_reversals "+
  "where request_id='"+rejection.data.request_id+"'"),'0');
 // Two valid refund requests race for the same remaining 15000 cents.
 // The common anchor lock must permit exactly one decision.
 const requests=await Promise.all(['A','B'].map(k=>rest(manager,'POST',
  'rpc/v56_request_team_direct_refund',{
   ...directRequest,p_idempotency_key:'V56-DIRECT-RACE-'+k+'-001',
   p_allocations:[{lesson_id:lesson,amount_cents:15000}]
  })));
 assert.deepEqual(requests.map(x=>x.status),[200,200]);
 const competing=await Promise.all(requests.map(x=>rest(manager,'POST',
  'rpc/v56_decide_team_direct_refund',{
   p_request_id:x.data.request_id,p_approve:true,
   p_reason:'Synthetic concurrent approved reversal under anchor lock'
  })));
 assert.equal(competing.filter(x=>x.status===200).length,1,
  'Only one racing request may consume the remaining refund capacity');
 assert.equal(db("select coalesce(sum(amount_cents),0) from tutor_private.v56_team_direct_refund_reversals "+
  "where payment_id='"+confirmed+"'"),'20000','Reversals cannot exceed gross allocation');
 assert.equal(db("select count(*) from tutor_private.v56_team_direct_refund_decisions "+
  "where payment_id='"+confirmed+"' and approved"),'2',
  'Failed conflicting approval must not leave partial decision');
 assert.notEqual((await rows(studentActor,'v56_team_direct_refund_decisions')).status,200);
 assert.notEqual((await rows(former,'v56_team_direct_refund_reversals')).status,200);


 // Approving an unapplied-credit refund reserves the balance under
 // the same workspace lock held by every existing V5.4 credit offset.
 const refund={p_credit_id:credit,p_amount_cents:60,
  p_idempotency_key:'V56-CREDIT-REFUND-001',
  p_reason:'Synthetic refund from unused advance credit'};
 assert.equal((await rest(studentActor,'POST','rpc/v56_request_team_credit_refund',
  refund)).status,403);
 r=await rest(manager,'POST','rpc/v56_request_team_credit_refund',refund);
 assert.equal(r.status,200);
 const request=r.data.request_id;
 assert.equal(r.data.status,'requested');
 r=await rest(manager,'POST','rpc/v56_request_team_credit_refund',refund);
 assert.equal(r.status,200);
 assert.equal(r.data.request_id,request);
 assert.equal(r.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_record_team_refund_manual_paid',{
  p_request_id:request,p_reference:'SYNTHETIC-NO-BANK-TRANSFER',
  p_paid_on:'2026-10-26',p_reason:'Synthetic premature completion denial'
 })).status,200,'Cannot mark paid before refund approved');
 assert.equal((await rest(former,'POST','rpc/v56_decide_team_credit_refund',{
  p_request_id:request,p_approve:true,p_reason:'Former manager denied'
 })).status,403);
 r=await rest(manager,'POST','rpc/v56_decide_team_credit_refund',{
  p_request_id:request,p_approve:true,p_reason:'Approved synthetic credit refund'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.status,'approved');
 r=await rest(manager,'POST','rpc/v56_decide_team_credit_refund',{
  p_request_id:request,p_approve:true,p_reason:'Approved synthetic credit refund'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_decide_team_credit_refund',{
  p_request_id:request,p_approve:false,p_reason:'Try to reverse decision'
 })).status,200,'Decision is immutable');
 let overview=await rest(manager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:db("select student_id from "+
   "tutor_private.v5_team_advance_credits where id='"+credit+"'")
 });
 assert.equal(overview.status,200);
 const creditRow=overview.data.credits.find(x=>x.credit_id===credit);
 assert.equal(creditRow.refund_reserved_cents,60);
 assert.equal(creditRow.available_cents,40);
 assert.notEqual((await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:[{lesson_id:lesson,amount_cents:41}],
  p_idempotency_key:'V56-OVERSPEND-BLOCKED-001'
 })).status,200,'Approved refund reserve prevents credit overspend');
 r=await rest(manager,'POST','rpc/v5_apply_team_advance_credit',{
  p_credit_id:credit,p_allocations:[{lesson_id:lesson,amount_cents:40}],
  p_idempotency_key:'V56-REMAINING-OFFSET-001'
 });
 assert.equal(r.status,200,'Remaining unused credit can offset a receivable');
 assert.equal(r.data.applied_cents,40);
 overview=await rest(manager,'POST','rpc/v5_team_advance_overview',{
  p_team_id:team,p_student_id:db("select student_id from "+
   "tutor_private.v5_team_advance_credits where id='"+credit+"'")
 });
 assert.equal(overview.data.credits.find(x=>x.credit_id===credit).available_cents,0);
 assert.notEqual((await rest(manager,'POST','rpc/v56_request_team_credit_refund',{
  p_credit_id:credit,p_amount_cents:1,
  p_idempotency_key:'V56-EXHAUSTED-REFUND-001',
  p_reason:'Cannot refund already reserved or applied credit'
 })).status,200);
 r=await rest(manager,'POST','rpc/v56_record_team_refund_manual_paid',{
  p_request_id:request,p_reference:'SYNTHETIC-NO-BANK-TRANSFER',
  p_paid_on:'2026-10-26',p_reason:'Manual synthetic payout recorded, no external bank'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.status,'manual_paid');
 assert.equal(r.data.bank_verified,false);
 r=await rest(manager,'POST','rpc/v56_record_team_refund_manual_paid',{
  p_request_id:request,p_reference:'SYNTHETIC-NO-BANK-TRANSFER',
  p_paid_on:'2026-10-26',p_reason:'Manual synthetic payout recorded, no external bank'
 });
 assert.equal(r.status,200);
 assert.equal(r.data.idempotent,true);
 const adjustments=await rest(manager,'POST','rpc/v56_team_adjustment_overview',{
  p_team_id:team,p_month:'2026-11-01'
 });
 assert.equal(adjustments.status,200);
 assert.ok(adjustments.data.pending_voids.some(x=>x.payment_id===pending));
 assert.ok(adjustments.data.corrections.some(x=>x.payment_id===confirmed));
 assert.ok(adjustments.data.refunds.some(x=>x.request_id===request&&x.status==='manual_paid'));
 assert.equal(adjustments.data.refunds_bank_verified,false);
 assert.equal((await rest(former,'POST','rpc/v56_team_adjustment_overview',{
  p_team_id:team,p_month:'2026-11-01'
 })).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_team_adjustment_overview',{
  p_team_id:team,p_month:'2026-11-01'
 })).status,403);
 const denied=await rows(studentActor,'v56_team_credit_refund_requests');
 assert.notEqual(denied.status,200,'No direct student access to private credit refunds');
 month=await rest(manager,'POST','rpc/v5_team_payment_overview',{
  p_team_id:team,p_month:'2026-10-01'
 });
 assert.equal(month.status,200);
 assert.ok(month.data.refund_reserved_cents>=60);
 assert.equal(db("select amount_cents from tutor_private.v5_team_advance_credits "+
  "where id='"+credit+"'"),initialCredit,'Original credit amount never edited');
 assert.equal(db("select count(*) from public.payment_batches"),beforeV4,
  'All V4 personal billing data remains untouched');
});



test('V5.6 P0-C/D/E real JWT validates net applied-credit reversal, refund holds, conservation and family denial',async()=>{
 const manager=await signIn('teacher'),former=await signIn('parent');
 const studentActor=await signIn('student'),stranger=await signIn('stranger');
 const oldOwner=f.actors.parent.id;
 const ws=db("select id from public.workspaces where owner_id='"+oldOwner+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+ws+"'");
 const credit=db("select c.id from tutor_private.v5_team_advance_credits c "+
  "join tutor_private.v5_team_payment_reports p on p.id=c.payment_id "+
  "where p.team_id='"+team+"' and p.reference='TRANSFER-ADVANCE-ISOLATION'");
 const op=db("select id from tutor_private.v5_team_advance_operations "+
  "where credit_id='"+credit+"' and idempotency_key='V56-REMAINING-OFFSET-001'");
 const lesson=db("select lesson_id from tutor_private.v5_team_advance_applications "+
  "where operation_id='"+op+"'");
 const student=db("select student_id from tutor_private.v5_team_advance_credits where id='"+credit+"'");
 for(const v of [ws,team,credit,op,lesson,student])assert.match(v,/^[a-f0-9-]{36}$/i);
 const net=()=>rest(manager,'POST','rpc/v56_team_conservation_overview',{p_team_id:team});
 const before=await net();
 assert.equal(before.status,200,JSON.stringify(before.data));
 assert.equal(before.data.conservation_passed,true);
 assert.equal(before.data.bank_verified,false);
 const scope={p_team_id:team,p_student_id:student};
 assert.equal((await rest(former,'POST','rpc/v56_team_refundable_allocations',scope)).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_team_refundable_allocations',scope)).status,403);
 assert.equal((await rest(stranger,'POST','rpc/v56_team_conservation_overview',{p_team_id:team})).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_team_conservation_overview',{p_team_id:team})).status,403);
 assert.equal((await rest(former,'POST','rpc/v56_team_conservation_overview',{p_team_id:team})).status,403);
 let source=await rest(manager,'POST','rpc/v56_team_refundable_allocations',scope);
 assert.equal(source.status,200,JSON.stringify(source.data));
 const entry=source.data.advance_applications.find(x=>x.credit_id===credit&&x.operation_id===op&&x.lesson_id===lesson);
 assert.equal(entry.remaining_cents,40);
 const args={p_credit_id:credit,p_entries:[{operation_id:op,lesson_id:lesson,amount_cents:30}],
  p_mode:'refund_reserved',p_idempotency_key:'V56-APPLIED-REFUND-001',
  p_reason:'Synthetic request to refund previously applied credit'};
 assert.equal((await rest(former,'POST','rpc/v56_request_team_applied_credit_adjustment',args)).status,403);
 let requested=await rest(manager,'POST','rpc/v56_request_team_applied_credit_adjustment',args);
 assert.equal(requested.status,200,JSON.stringify(requested.data));
 assert.equal(requested.data.status,'requested_no_settlement');
 const id=requested.data.request_id;
 requested=await rest(manager,'POST','rpc/v56_request_team_applied_credit_adjustment',args);
 assert.equal(requested.status,200);
 assert.equal(requested.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_request_team_applied_credit_adjustment',{
  ...args,p_entries:[{operation_id:op,lesson_id:lesson,amount_cents:29}]
 })).status,200,'Idempotency payload cannot be rewritten');
 assert.equal((await rest(studentActor,'POST','rpc/v56_decide_team_applied_credit_adjustment',{
  p_request_id:id,p_approve:true,p_reason:'Student is not the manager'
 })).status,403);
 const beforeApproval=await net();
 assert.equal(beforeApproval.status,200);
 assert.equal(beforeApproval.data.advance_net_cents,before.data.advance_net_cents);
 let decided=await rest(manager,'POST','rpc/v56_decide_team_applied_credit_adjustment',{
  p_request_id:id,p_approve:true,p_reason:'Synthetic manager approves applied-credit refund reservation'
 });
 assert.equal(decided.status,200,JSON.stringify(decided.data));
 assert.equal(decided.data.status,'approved_refund_reserved');
 assert.equal(decided.data.manual_paid,false);
 assert.equal(decided.data.bank_verified,false);
 decided=await rest(manager,'POST','rpc/v56_decide_team_applied_credit_adjustment',{
  p_request_id:id,p_approve:true,p_reason:'Synthetic manager approves applied-credit refund reservation'
 });
 assert.equal(decided.status,200);
 assert.equal(decided.data.idempotent,true);
 assert.notEqual((await rest(manager,'POST','rpc/v56_decide_team_applied_credit_adjustment',{
  p_request_id:id,p_approve:false,p_reason:'Conflicting decision must not succeed'
 })).status,200);
 const after=await net();
 assert.equal(after.status,200,JSON.stringify(after.data));
 assert.equal(after.data.conservation_passed,true);
 assert.equal(after.data.advance_net_cents,before.data.advance_net_cents-30);
 assert.equal(after.data.outstanding_cents,before.data.outstanding_cents+30);
 assert.equal(after.data.applied_credit_refund_liability_cents,
  before.data.applied_credit_refund_liability_cents+30);
 assert.equal(after.data.advance_available_cents,before.data.advance_available_cents,
  'Refunded applied credit must be held, not become available for another offset');
 assert.equal(after.data.confirmed_cash_book_cents,before.data.confirmed_cash_book_cents);
 assert.equal(after.data.bank_verified,false);
 // Applied-credit reversals must also flow through V5.7 per-project balances.
 const appliedMonth={p_team_id:team,p_month:'2026-10-01'};
 const [projectAfterAdvance,monthlyAfterAdvance]=await Promise.all([
  rest(manager,'POST','rpc/v5_team_operations_overview',appliedMonth),
  rest(manager,'POST','rpc/v5_team_payment_overview',appliedMonth)
 ]);
 assert.equal(projectAfterAdvance.status,200,JSON.stringify(projectAfterAdvance.data));
 assert.equal(monthlyAfterAdvance.status,200,JSON.stringify(monthlyAfterAdvance.data));
 assert.equal(projectAfterAdvance.data.ledger_basis,'net_after_immutable_reversals');
 assert.equal(projectAfterAdvance.data.cash_verified_by_bank,false);
 const projectsAfterAdvance=projectAfterAdvance.data.projects;
 assert.equal(projectsAfterAdvance.reduce((sum,p)=>sum+p.outstanding_cents,0),
  monthlyAfterAdvance.data.outstanding_cents);
 assert.equal(projectsAfterAdvance.reduce((sum,p)=>sum+p.advance_net_cents,0),
  monthlyAfterAdvance.data.advance_applied_cents);
 assert.equal(projectsAfterAdvance.reduce((sum,p)=>sum+p.direct_net_cents,0),
  monthlyAfterAdvance.data.direct_allocated_cents);
 assert.ok(projectsAfterAdvance.every(p=>p.confirmed_receivable_cents===
  p.direct_net_cents+p.advance_net_cents+p.outstanding_cents));
 assert.notEqual((await rows(studentActor,'v56_team_advance_application_reversals')).status,200);
 assert.notEqual((await rows(former,'v56_team_applied_credit_decisions')).status,200);
 const late={...args,p_idempotency_key:'V56-APPLIED-EXCESS-001',
  p_entries:[{operation_id:op,lesson_id:lesson,amount_cents:11}]};
 const reqLate=await rest(manager,'POST','rpc/v56_request_team_applied_credit_adjustment',late);
 assert.equal(reqLate.status,200);
 assert.notEqual((await rest(manager,'POST','rpc/v56_decide_team_applied_credit_adjustment',{
  p_request_id:reqLate.data.request_id,p_approve:true,
  p_reason:'Refund over original allocation must not be approved'
 })).status,200,'Cannot approve more than remaining 10 cents');

 // No valid explicit family bridge means NO parent/student Team ledger,
 // even if the caller used to be the Team manager with a valid JWT.
 const today=new Date();
 const month=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),'01'].join('-');
 const query={p_team_id:team,p_team_student_id:student,p_month:month};
 assert.equal((await rest(former,'POST','rpc/v56_team_parent_finance_overview',query)).status,403);
 assert.equal((await rest(studentActor,'POST','rpc/v56_team_parent_finance_overview',query)).status,403);
 assert.equal((await rest(stranger,'POST','rpc/v56_team_parent_finance_overview',query)).status,403);
 const listings=await rest(studentActor,'POST','rpc/v56_my_team_family_proposals',{});
 assert.equal(listings.status,200);
 assert.deepEqual(listings.data.proposals,[]);
 // A refund manual payment is only a manager declaration, not bank verification.
 const paidArgs={p_source:'applied_credit',p_request_id:id,
  p_reference:'V56-SYNTHETIC-MANUAL-NO-BANK',p_paid_on:'2026-10-26',
  p_reason:'Synthetic manual payout declaration for isolated QA only'};
 assert.equal((await rest(former,'POST','rpc/v56_record_allocated_refund_manual_paid',paidArgs)).status,403);
 let manual=await rest(manager,'POST','rpc/v56_record_allocated_refund_manual_paid',paidArgs);
 assert.equal(manual.status,200,JSON.stringify(manual.data));
 assert.equal(manual.data.bank_verified,false);
 manual=await rest(manager,'POST','rpc/v56_record_allocated_refund_manual_paid',paidArgs);
 assert.equal(manual.status,200);
 assert.equal(manual.data.idempotent,true);
 const final=await net();
 assert.equal(final.status,200);
 assert.equal(final.data.allocated_manual_paid_refunds_cents,30);
 assert.equal(final.data.bank_verified,false);
 assert.equal(db("select count(*) from tutor_private.v56_team_applied_credit_decisions "+
  "where request_id='"+id+"' and approved"),'1');
});


test('V5.6 P0-E live V4 guardian consent allows only mapped Team student and revokes old JWT on unlink',async()=>{
 const manager=await signIn('teacher'),parent=await signIn('parent'),child=await signIn('student');
 const managerId=f.actors.teacher.id,parentId=f.actors.parent.id;
 const personalWs=db("select id from public.workspaces where owner_id='"+managerId+"' limit 1");
 const teamWs=db("select id from public.workspaces where owner_id='"+parentId+"' limit 1");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+teamWs+"'");
 const teamStudent=db("select student_id from tutor_private.v5_team_advance_credits "+
  "where team_id='"+team+"' limit 1");
 for(const v of [personalWs,teamWs,team,teamStudent])assert.match(v,/^[a-f0-9-]{36}$/i);
 // Only disposable GitHub SQL fixture: make one synthetic personal student
 // and accepted guardian link with its own distinct, non-Team UUID.
 const v4Student=db("insert into public.students(teacher_id,name,subject,hourly_rate,workspace_id) "+
  "values('"+managerId+"','V56 Synthetic Family Link','數學',500,'"+personalWs+"') returning id").split('\n')[0];
 assert.match(v4Student,/^[a-f0-9-]{36}$/i);
 assert.notEqual(v4Student,teamStudent,'Team student IDs are not V4 student IDs');
 const email=f.actors.parent.email.replaceAll("'","''");
 const invite=db("insert into public.guardian_invites(teacher_id,student_id,email,workspace_id) "+
  "values('"+managerId+"','"+v4Student+"','"+email+"','"+personalWs+"') returning id").split('\n')[0];
 db("insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id,workspace_id) "+
  "values('"+managerId+"','"+v4Student+"','"+parentId+"','"+invite+"','"+personalWs+"')");
 assert.notEqual((await rest(manager,'POST','rpc/v56_propose_team_family_bridge',{
  p_team_student_id:teamStudent,p_v4_student_id:'00000000-0000-0000-0000-000000000001',
  p_reason:'Must never invent a V4 student relationship'
 })).status,200);
 let proposed=await rest(manager,'POST','rpc/v56_propose_team_family_bridge',{
  p_team_student_id:teamStudent,p_v4_student_id:v4Student,
  p_reason:'Synthetic V4 guardian-to-Team explicit consent QA'
 });
 assert.equal(proposed.status,200,JSON.stringify(proposed.data));
 assert.equal(proposed.data.status,'proposed_waiting_guardian_acceptance');
 const proposal=proposed.data.proposal_id;
 const query={p_team_id:team,p_team_student_id:teamStudent,p_month:'2026-10-01'};
 assert.equal((await rest(parent,'POST','rpc/v56_team_parent_finance_overview',query)).status,403,
  'A proposed mapping is not a parent finance grant');
 assert.equal((await rest(child,'POST','rpc/v56_team_parent_finance_overview',query)).status,403);
 const list=await rest(parent,'POST','rpc/v56_my_team_family_proposals',{});
 assert.equal(list.status,200);
 assert.ok(list.data.proposals.some(x=>x.proposal_id===proposal&&x.status==='pending'));
 assert.equal((await rest(child,'POST','rpc/v56_respond_team_family_proposal',{
  p_proposal_id:proposal,p_accept:true
 })).status,403);
 let response=await rest(parent,'POST','rpc/v56_respond_team_family_proposal',{
  p_proposal_id:proposal,p_accept:true
 });
 assert.equal(response.status,200,JSON.stringify(response.data));
 assert.equal(response.data.status,'accepted');
 let view=await rest(parent,'POST','rpc/v56_team_parent_finance_overview',query);
 assert.equal(view.status,200,JSON.stringify(view.data));
 assert.equal(view.data.team_id,team);
 assert.equal(view.data.student_id,teamStudent);
 assert.equal(view.data.currency,'TWD');
 assert.equal(view.data.bank_verified,false);
 assert.ok(Array.isArray(view.data.receivables));
 assert.ok(Array.isArray(view.data.correction_refund_history));
 assert.equal(JSON.stringify(view.data).includes('hourly_rate_cents'),false);
 assert.equal(JSON.stringify(view.data).includes('teacher_user_id'),false);
 assert.equal((await rest(parent,'POST','rpc/v56_team_parent_finance_overview',{
  ...query,p_team_student_id:'00000000-0000-0000-0000-000000000002'
 })).status,403,'Mapped parent cannot read a different Team student');
 response=await rest(parent,'POST','rpc/v56_respond_team_family_proposal',{
  p_proposal_id:proposal,p_accept:false
 });
 assert.equal(response.status,200);
 assert.equal(response.data.status,'revoked');
 assert.equal((await rest(parent,'POST','rpc/v56_team_parent_finance_overview',query)).status,403);
 assert.notEqual((await rest(parent,'POST','rpc/v56_respond_team_family_proposal',{
  p_proposal_id:proposal,p_accept:true
 })).status,200,'Revocation is immutable and requires new proposal');
 // New explicit approval; then the live V4 guardian invite disappears.
 proposed=await rest(manager,'POST','rpc/v56_propose_team_family_bridge',{
  p_team_student_id:teamStudent,p_v4_student_id:v4Student,
  p_reason:'Second synthetic mapping to prove unlink revokes old JWT'
 });
 assert.equal(proposed.status,200);
 const newProposal=proposed.data.proposal_id;
 response=await rest(parent,'POST','rpc/v56_respond_team_family_proposal',{
  p_proposal_id:newProposal,p_accept:true
 });
 assert.equal(response.status,200);
 assert.equal((await rest(parent,'POST','rpc/v56_team_parent_finance_overview',query)).status,200);
 db("delete from public.guardian_invites where id='"+invite+"'");
 assert.equal(db("select count(*) from public.student_guardians where student_id='"+v4Student+"'"),'0',
  'V4 invitation removal immediately revokes parent connection');
 assert.equal((await rest(parent,'POST','rpc/v56_team_parent_finance_overview',query)).status,403,
  'Old still-valid parent JWT cannot read after live guardian unlink');
 const afterUnlink=await rest(parent,'POST','rpc/v56_my_team_family_proposals',{});
 assert.equal(afterUnlink.status,200);
 assert.deepEqual(afterUnlink.data.proposals,[]);
 assert.notEqual((await rows(parent,'v56_team_family_bridge_acceptances')).status,200,
  'Private consent audit must not be readable via Data API');
});

test('V5.6 manager GUI enables append-only pending void and displays audited refund history',async({page})=>{
 // Isolated synthetic actor and Team B from the previous manager transfer
 // and V5.6 backend tests; no real bank, family, course, or production writes.
 const owner=f.actors.parent.id,manager=f.actors.teacher;
 const teamWs=db("select id from public.workspaces where owner_id='"+owner+"'");
 const team=db("select id from public.v5_teams where anchor_workspace_id='"+teamWs+"'");
 const student=db("select c.student_id from tutor_private.v5_team_advance_credits c "+
  "join tutor_private.v5_team_payment_reports p on p.id=c.payment_id "+
  "where c.team_id='"+team+"' and p.reference='TRANSFER-ADVANCE-ISOLATION'");
 assert.match(student,/^[0-9a-f-]{36}$/i);
 const jwt=await signIn('teacher');
 let submitted=await rest(jwt,'POST','rpc/v5_report_team_payment',{
  p_team_id:team,p_student_id:student,p_amount_cents:100,
  p_received_on:'2026-10-26',p_method:'cash',
  p_reference:'V56-UI-PENDING-001',
  p_note:'Synthetic UI pending item, never a bank transfer'
 });
 assert.equal(submitted.status,200);
 const payment=submitted.data.payment_id;
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
  if(error)throw Error('Isolated V5.6 Team manager login failed');
  supa.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:manager.email,password:manager.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await openTeamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(team);
 // Synthetic pending payment was received in October; its event history is
 // added in November after the manager's UI action.
 await page.locator('#v5-billing-prev').click();
 await expect(page.locator('#v56-adjustments-panel')).toBeVisible();
 await expect(page.locator('#v56-adjustments-message')).toContainText('現任 Team 管理者');
 const pending=page.locator('#v56-adjustments-payments [data-v56-action="void"][data-id="'+payment+'"]');
 await expect(pending).toBeVisible();
 page.on('dialog',dialog=>dialog.type()==='prompt'?
  dialog.accept('Synthetic GUI pending void approved for testing'):dialog.accept());
 await pending.click();
 await expect.poll(()=>db("select count(*) from tutor_private.v56_team_pending_payment_voids "+
  "where payment_id='"+payment+"'"),{timeout:15000}).toBe('1');
 await expect(page.locator('#v56-adjustments-payments')).toContainText('已沖銷');
 await page.locator('#v5-billing-next').click();
 await expect(page.locator('#v56-adjustments-panel')).toBeVisible();
 await expect(page.locator('#v56-adjustments-history')).toContainText('付款更正');
 await expect(page.locator('#v56-adjustments-history')).toContainText('預收款退款');
 await expect(page.locator('#v56-adjustments-history')).toContainText('管理者登記已付款');
 await expect(page.locator('#v56-adjustments-history')).toContainText('待確認付款沖銷');
 assert.equal(db("select status from tutor_private.v5_team_payment_reports where id='"+
  payment+"'"),'pending','GUI void preserves original unconfirmed ledger row');
});
