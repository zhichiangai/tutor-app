// V5.1 contract against disposable localhost Supabase and synthetic users ONLY.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

if(process.env.V4_E2E_LOCAL!=='1')throw Error('Refuse V5 E2E outside isolated CI');
const fixtureFile=process.env.V4_E2E_FIXTURE_FILE;
if(!fixtureFile?.startsWith('/'))throw Error('Isolated fixture path required');
const f=JSON.parse(readFileSync(fixtureFile,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
function db(sql){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
  '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',sql],
 {encoding:'utf8'}).trim();
}
async function login(role){
 const actor=f.actors[role];
 const response=await fetch(f.apiUrl+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:f.anonKey,'content-type':'application/json'},
  body:JSON.stringify({email:actor.email,password:actor.password})
 });
 assert.equal(response.status,200,'local GoTrue synthetic login');
 return (await response.json()).access_token;
}
async function rest(jwt,method,path,body=null){
 const headers={apikey:f.anonKey,Authorization:'Bearer '+jwt,
  'content-type':'application/json',Prefer:'return=representation'};
 const response=await fetch(f.apiUrl+'/rest/v1/'+path,
  {method,headers,...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json().catch(()=>null)};
}
const newStudent=(teacherId)=>({
 id:randomUUID(),teacher_id:teacherId,name:'V5 Synthetic Student',
 subject:'數學',hourly_rate:500
});
test('Free cumulative student quota, manual Pro/Team grants and teacher cap',async ()=>{
 const teacher=await login('teacher');
 const other=await login('stranger');
 const teacherId=f.actors.teacher.id;
 const ws=db("select id from public.workspaces where owner_id='"+teacherId+"'");
 assert.match(ws,/^[a-f0-9-]{36}$/i);
 const getPlan=async (jwt=teacher)=>rest(jwt,'POST','rpc/v5_my_plan',{});
 let plan=await getPlan();
 assert.equal(plan.status,200);
 assert.equal(plan.data.plan,'free');
 assert.equal(plan.data.student_limit,3);
 assert.equal(plan.data.teacher_limit,1);
 assert.equal(plan.data.student_used,2,'V4 fixture has two synthetic students');

 // Non-owner never receives another workspace's entitlement details.
 const outsider=await getPlan(other);
 assert.equal(outsider.status,200);
 assert.equal(outsider.data,null);

 const third=newStudent(teacherId);
 let result=await rest(teacher,'POST','students?select=id',third);
 assert.equal(result.status,201);
 assert.equal((await getPlan()).data.student_used,3);

 // Deleting a student cannot recycle their seat.
 const denied=newStudent(teacherId);
 result=await rest(teacher,'POST','students?select=id',denied);
 assert.notEqual(result.status,201,'Free 4th student must be blocked in DB');
 result=await rest(teacher,'DELETE','students?id=eq.'+third.id);
 assert.equal(result.status,200);
 assert.equal((await getPlan()).data.student_used,3);
 result=await rest(teacher,'POST','students?select=id',third);
 assert.notEqual(result.status,201,'reusing a deleted student UUID must be rejected');
 result=await rest(teacher,'POST','students?select=id',newStudent(teacherId));
 assert.notEqual(result.status,201,'hard delete must not regain lifetime seat');

 // A signed-in browser cannot grant a different plan.
 result=await rest(teacher,'PATCH',
   'v5_workspace_entitlements?workspace_id=eq.'+ws,
   {plan_code:'team',extra_student_seats:999});
 assert.notEqual(result.status,200,'Plan modification must be server-authorized');
 assert.equal((await getPlan()).data.plan,'free');

 // Teacher quota counts workspace owner, even though the owner is a member.
 const extraMember=f.actors.parent.id;
 assert.throws(()=>db("insert into public.workspace_members(workspace_id,user_id,role) "+
  "values('"+ws+"','"+extraMember+"','teacher')"),/已達老師名額|quota|名額/);

 // Only privileged local SQL administration grants a plan, with audit trail.
 db("select tutor_private.v5_admin_grant_entitlement('"+ws+"','pro',0,"+
  "'CI operator','Synthetic authorized plan upgrade');");
 plan=await getPlan();
 assert.equal(plan.data.plan,'pro');
 assert.equal(plan.data.monthly_price_twd,99);
 assert.equal(plan.data.billing_enabled,false);
 assert.equal(plan.data.student_limit,30);
 result=await rest(teacher,'POST','students?select=id',newStudent(teacherId));
 assert.equal(result.status,201);
 assert.equal((await getPlan()).data.student_used,4);

 db("select tutor_private.v5_admin_grant_entitlement('"+ws+"','team',0,"+
  "'CI operator','Synthetic authorized Team grant');");
 plan=await getPlan();
 assert.equal(plan.data.teacher_limit,10);
 assert.equal(plan.data.student_limit,100);
 db("insert into public.workspace_members(workspace_id,user_id,role) "+
  "values('"+ws+"','"+extraMember+"','teacher')");
 // V5.2 Team quota is independent from V4 workspace owner memberships.
 db("insert into public.v5_team_roster(workspace_id,user_id) "+
  "values('"+ws+"','"+extraMember+"')");
 assert.equal((await getPlan()).data.teacher_used,2);

 db("select tutor_private.v5_admin_grant_entitlement('"+ws+"','free',0,"+
  "'CI operator','Synthetic downgrade preserves history');");
 plan=await getPlan();
 assert.equal(plan.data.student_used,4);
 assert.equal(plan.data.student_can_add,false);
 assert.equal(plan.data.teacher_used,2);
 assert.equal(plan.data.teacher_can_add,false);
 assert.equal(plan.data.student_limit,3);
 result=await rest(teacher,'POST','students?select=id',newStudent(teacherId));
 assert.notEqual(result.status,201);

 const audit=db("select count(*) from tutor_private.v5_entitlement_grant_audit "+
   "where workspace_id='"+ws+"'");
 assert.equal(Number(audit),3);
});


test('teacher settings shows Free/Plus/Team without checkout or hidden quotas',async ({page})=>{
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
 await page.evaluate(async ({url,key,email,password})=>{
  const client=window.supabase.createClient(url,key,{auth:{persistSession:true,
   autoRefreshToken:true,detectSessionInUrl:true}});
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic login failed: '+error.message);
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-plan-card')).toBeVisible();
 await expect(page.locator('#v5-plan-content')).toContainText('Free');
 await expect(page.locator('#v5-plan-content')).toContainText('Plus');
 await expect(page.locator('#v5-plan-content')).toContainText('Team');
 await expect(page.locator('#v5-plan-content')).toContainText('Plus／Team 正式金流尚未開放');
 await expect(page.locator('#v5-plan-content')).toContainText('NT$99／月');
 await expect(page.locator('#v5-plan-content')).toContainText('NT$399／月');
 await expect(page.locator('#v5-plan-content')).toContainText('不會釋放已使用名額');
 await expect(page.locator('#v5-plan-card')).not.toContainText('立即訂閱');
 // The first test intentionally downgraded this owner to Free with four
 // historical seats; the friendly UI must lead back to the plan wall.
 await page.locator('.side-nav .nav-standard[data-view="students"]').click();
 await page.locator('#add-student').click();
 await expect(page.locator('#view-settings')).toBeVisible();
 await expect(page.locator('#student-modal')).not.toBeVisible();
});


test('missing V5 RPC still shows read-only Free/Plus/Team cards to signed-in teacher',async ({page})=>{
 const actor=f.actors.teacher;
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={environment:'local',isolated:true,projectRef:'local',
   url,publishableKey:key};
 },{url:f.apiUrl,key:f.anonKey});
 await page.route('**/rest/v1/rpc/v5_my_plan',route=>route.fulfill({
  status:404,contentType:'application/json',
  body:JSON.stringify({code:'PGRST202',
   message:'Could not find the function public.v5_my_plan'})
 }));
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>!!window.supabase?.createClient,{timeout:20_000});
 await page.evaluate(async ({url,key,email,password})=>{
  const client=window.supabase.createClient(url,key,{auth:{persistSession:true,
   autoRefreshToken:true,detectSessionInUrl:true}});
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic login failed: '+error.message);
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#v5-plan-card')).toBeVisible();
 const plan=page.locator('#v5-plan-content');
 await expect(plan).toContainText('方案後端尚未啟用');
 await expect(plan).toContainText('目前使用方案及名額尚無法確認');
 await expect(plan).toContainText('Free');
 await expect(plan).toContainText('Plus');
 await expect(plan).toContainText('Team');
 await expect(plan).toContainText('NT$99／月');
 await expect(plan).toContainText('NT$399／月');
 await expect(plan).not.toContainText('目前方案：');
 await expect(plan).not.toContainText(' · 目前使用');
 await expect(plan).not.toContainText('立即訂閱');
});

test('QA seat reset is operator-only, exact-count audited and never deletes live rows',async()=>{
 const teacher=await login('teacher');
 const wid=db("select id from public.workspaces where owner_id='"+f.actors.teacher.id+"'");
 const getCount=()=>Number(db("select count(*) from tutor_private.v5_student_seat_ledger "+
  "where workspace_id='"+wid+"'"));
 // Previous V5 tests downgraded this workspace; manual grant is needed.
 db("select tutor_private.v5_admin_grant_entitlement('"+wid+"','pro',0,"+
  "'CI operator','Allow synthetic QA seat release test');");
 const baseCount=getCount();
 const qa={...newStudent(f.actors.teacher.id),is_qa:true};
 let result=await rest(teacher,'POST','students?select=id',qa);
 assert.equal(result.status,201);
 assert.equal(getCount(),baseCount+1);
 assert.equal(db("select is_qa_at_first_seen from tutor_private.v5_student_seat_ledger "+
  "where workspace_id='"+wid+"' and student_id='"+qa.id+"'"),'t');
 result=await rest(teacher,'DELETE','students?id=eq.'+qa.id);
 assert.equal(result.status,200);
 assert.equal(getCount(),baseCount+1,'ordinary deletion does not release cumulative QA seat');
 const eligible=Number(db("select count(*) from tutor_private.v5_student_seat_ledger l "+
  "where l.workspace_id='"+wid+"' and l.is_qa_at_first_seen and "+
  "not exists(select 1 from public.students s where s.id=l.student_id)"));
 assert.equal(eligible,1);
 assert.notEqual((await rest(teacher,'POST','rpc/v5_admin_snapshot',{})).status,200,
  'Browser user cannot invoke service-role-only snapshot');
 assert.notEqual((await rest(teacher,'POST','rpc/v5_admin_release_qa_seats',{
  p_workspace_id:wid,p_expected_count:1,p_operator_user_id:f.actors.teacher.id,
  p_reason:'Attempt client-sided QA cleanup'})).status,200,
  'Browser user cannot invoke service-role-only QA release');
 assert.throws(()=>db("select public.v5_admin_release_qa_seats('"+wid+"',2,"+
  "'"+f.actors.teacher.id+"','Synthetic mismatch should abort');"),
  /count changed|expected|actual/i);
 assert.equal(getCount(),baseCount+1,'mismatch must not partially delete');
 const released=db("select public.v5_admin_release_qa_seats('"+wid+"',1,"+
  "'"+f.actors.teacher.id+"','Synthetic isolated QA seat cleanup');");
 assert.equal(released,'1');
 assert.equal(getCount(),baseCount,'only deleted QA seat released');
 assert.equal(Number(db("select count(*) from tutor_private.v5_qa_seat_release_audit "+
   "where workspace_id='"+wid+"'")),1);
 assert.equal(Number(db("select count(*) from public.students where id='"+qa.id+"'")),0);
 assert.ok(getCount()>=4,'previously deleted non-QA students still consume seats');
 const audit=db("select released_count from tutor_private.v5_qa_seat_release_audit "+
  "where workspace_id='"+wid+"'");
 assert.equal(audit,'1');
});
