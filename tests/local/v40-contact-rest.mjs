// Opt-in localhost-only GoTrue JWT / PostgREST integration test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
assert.equal(process.env.V40_LOCAL_CONTACT_TEST,'1');
const root=new URL('../../',import.meta.url).pathname;
const s=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8',env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'1'}}));
assert.equal(s.API_URL,'http://127.0.0.1:54321');
assert.match(s.DB_URL,/127\.0\.0\.1:54322\/postgres$/);
const sql=q=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',q],{encoding:'utf8'}).trim();
const users={};let count=0;
for(const label of ['teacherA','teacherB','parentA','parentB','studentA','studentB']){
 const email=`c${label.toLowerCase()}-${randomBytes(4).toString('hex')}@local.invalid`,password=randomBytes(24).toString('base64url')+'aA1';
 const r=await fetch(s.API_URL+'/auth/v1/signup',{method:'POST',headers:{apikey:s.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));assert.ok(j.access_token);count+=2;
 users[label]={id:j.user.id,email,jwt:j.access_token};
}
const {teacherA:tA,teacherB:tB,parentA:pA,parentB:pB,studentA:stA}=users;
async function call(who,name,args={}){
 const r=await fetch(s.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:s.ANON_KEY,...(who?{Authorization:'Bearer '+who.jwt}:{}),'Content-Type':'application/json'},body:JSON.stringify(args)});
 return {status:r.status,body:await r.json()};
}
async function ok(who,name,args={}){const r=await call(who,name,args);assert.equal(r.status,200,JSON.stringify(r.body));count++;return r.body;}
async function denied(who,name,args={}){const r=await call(who,name,args);assert.notEqual(r.status,200,JSON.stringify(r.body));count++;}
async function inbox(who,n){const rows=await ok(who,'v4_contact_inbox');assert.equal(rows.length,n,JSON.stringify(rows));count++;return rows;}
async function request(sender,recipient,role){assert.deepEqual(await ok(sender,'v4_contact_request',{p_email:recipient.email,p_my_role:role}),{submitted:true});count++}
await denied(null,'v4_contact_inbox');await denied(null,'v4_contact_request',{p_email:pA.email,p_my_role:'teacher'});
await request(tA,pA,'teacher');
const unknown={email:`unknown-${randomUUID()}@local.invalid`};
assert.deepEqual(await ok(tA,'v4_contact_request',{p_email:unknown.email,p_my_role:'teacher'}),{submitted:true});count++;
await inbox(tA,0); // A registered address and an unknown address are indistinguishable to the sender.
let rows=await inbox(pA,1);const pairA=rows[0].id;
await denied(tA,'v4_contact_action',{p_id:pairA,p_action:'approve'});
await denied(pB,'v4_contact_action',{p_id:pairA,p_action:'approve'});
const table=await fetch(s.API_URL+'/rest/v1/v4_account_contacts?select=id',{headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+pA.jwt}});
assert.equal(table.status,403);count++;
assert.equal(await ok(pA,'v4_contact_action',{p_id:pairA,p_action:'approve'}),'connected');count++;
await denied(pA,'v4_contact_action',{p_id:pairA,p_action:'approve'});
await inbox(tA,1);await inbox(pA,1);
await request(tB,pA,'teacher');let pairB=(await inbox(pA,2)).find(r=>r.status==='pending').id;
assert.equal(await ok(pA,'v4_contact_action',{p_id:pairB,p_action:'approve'}),'connected');count++;
await request(tA,pB,'teacher');let pairC=(await inbox(pB,1))[0].id;
assert.equal(await ok(pB,'v4_contact_action',{p_id:pairC,p_action:'approve'}),'connected');count++;
await request(tA,pA,'teacher');assert.equal(sql(`select count(*) from public.v4_account_contacts where teacher_id='${tA.id}' and parent_id='${pA.id}' and status='connected'`),'1');count++;
assert.equal(await ok(pA,'v4_contact_action',{p_id:pairA,p_action:'disconnect'}),'disconnected');count++;
assert.equal((await inbox(pA,1))[0].id,pairB);count++;
assert.equal((await inbox(tA,1))[0].id,pairC);count++;
await denied(pA,'v4_contact_action',{p_id:pairA,p_action:'disconnect'});
await request(pA,tA,'parent');const pairD=(await inbox(tA,2)).find(r=>r.status==='pending').id;
assert.equal(await ok(pA,'v4_contact_action',{p_id:pairD,p_action:'cancel'}),'cancelled');count++;
await denied(tA,'v4_contact_action',{p_id:pairD,p_action:'approve'});
await request(tA,pA,'teacher');const pairE=(await inbox(pA,2)).find(r=>r.status==='pending').id;
assert.equal(await ok(pA,'v4_contact_action',{p_id:pairE,p_action:'decline'}),'declined');count++;
await denied(pA,'v4_contact_action',{p_id:pairE,p_action:'approve'});
assert.equal((await inbox(stA,0)).length,0);count++;
assert.equal(sql('select count(*) from public.student_guardians'),'0');count++;
assert.equal(sql('select count(*) from public.payment_batches'),'0');count++;
// An existing teaching relationship and its historical payment survive a
// separate address-book unlink. The child is a profile, not an Auth account.
const child=randomUUID(),invite=randomUUID(),lesson=randomUUID(),batch=randomUUID();
sql(`begin;
insert into public.workspaces(owner_id) values ('${tA.id}');
insert into public.students(id,teacher_id,name) values ('${child}','${tA.id}','Synthetic child without login');
insert into public.guardian_invites(id,teacher_id,student_id,email) values ('${invite}','${tA.id}','${child}','${pB.email}');
insert into public.student_guardians(teacher_id,student_id,guardian_id,invite_id) values ('${tA.id}','${child}','${pB.id}','${invite}');
insert into public.lesson_records(id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status,received_date)
 values ('${lesson}','${tA.id}','${child}','2026-09-01','lesson',2,500,1000,'老師已收到','2026-09-03');
insert into public.payment_batches(id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
 values ('${batch}','${tA.id}','${child}','${pB.id}','2026-09-01','2026-09-01','2026-09-03',1000,'confirmed','2026-09-03',now());
insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount) values ('${batch}','${lesson}',1000);
commit;`);
async function restRows(who,path){const r=await fetch(s.API_URL+'/rest/v1/'+path,{headers:{apikey:s.ANON_KEY,Authorization:'Bearer '+who.jwt}});assert.equal(r.status,200);count++;return r.json()}
assert.equal((await restRows(pB,`payment_batches?select=id&id=eq.${batch}`)).length,1);count++;
assert.equal(await ok(pB,'v4_contact_action',{p_id:pairC,p_action:'disconnect'}),'disconnected');count++;
assert.equal(sql(`select count(*) from public.student_guardians where student_id='${child}' and guardian_id='${pB.id}'`),'1');count++;
assert.equal((await restRows(pB,`payment_batches?select=id&id=eq.${batch}`)).length,1);count++;
assert.equal((await restRows(pA,`payment_batches?select=id&id=eq.${batch}`)).length,0);count++;
assert.equal((await restRows(stA,`payment_batches?select=id&id=eq.${batch}`)).length,0);count++;
// Row locking serializes competing approvals: exactly one may succeed.
await request(tB,pB,'teacher');const concurrent=(await inbox(pB,1))[0].id;
const racing=await Promise.all([call(pB,'v4_contact_action',{p_id:concurrent,p_action:'approve'}),call(pB,'v4_contact_action',{p_id:concurrent,p_action:'approve'})]);
assert.equal(racing.filter(x=>x.status===200).length,1);count++;
assert.equal(racing.filter(x=>x.status!==200).length,1);count++;
console.log(JSON.stringify({result:'PASS',localAuthJWT:6,assertions:count,productionWrites:0}));
