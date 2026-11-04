// V5.1 contract against disposable localhost Supabase and synthetic users ONLY.
import {test} from '@playwright/test';
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
 const getPlan=async jwt=teacher=>rest(jwt,'POST','rpc/v5_my_plan',{})
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
