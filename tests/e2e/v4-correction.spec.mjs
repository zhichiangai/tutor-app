// Browser-level teacher payment correction; disposable localhost Supabase only.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.ok(process.env.V4_E2E_FIXTURE_FILE?.startsWith('/'));
const f=JSON.parse(readFileSync(process.env.V4_E2E_FIXTURE_FILE,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
const db=query=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated',
 'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',query],
 {encoding:'utf8'}).trim();
test('teacher previews and confirms an audited partial payment correction in Chromium',async ({page})=>{
 const users={};
 for(const role of ['teacher','parent']){
  const email='correction-'+role+'-'+randomUUID()+'@local.invalid';
  const password=randomBytes(22).toString('base64url')+'aA1';
  const response=await fetch(f.apiUrl+'/auth/v1/signup',{
   method:'POST',headers:{apikey:f.anonKey,'Content-Type':'application/json'},
   body:JSON.stringify({email,password})});
  const data=await response.json();
  assert.equal(response.status,200,'Synthetic GoTrue signup failed for '+role);
  assert.ok(data.access_token);
  users[role]={id:data.user.id,email,password};
 }
 const ids=Object.fromEntries(['student','lesson','batch'].map(k=>[k,randomUUID()]));
 const t=users.teacher,p=users.parent;
 db(`begin;
 insert into public.workspaces(owner_id) values('${t.id}');
 insert into public.students(id,teacher_id,name,subject,hourly_rate)
  values('${ids.student}','${t.id}','CI Payment Correction','數學',400);
 insert into public.lesson_records
  (id,owner_id,student_id,lesson_date,type,start_time,end_time,hours,hourly_rate,total_amount,status,received_date)
  values('${ids.lesson}','${t.id}','${ids.student}','${f.day}','lesson','17:00','18:00',1,400,400,'老師已收到','${f.day}');
 insert into public.payment_batches
  (id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,paid_amount,status,received_on,confirmed_at)
  values('${ids.batch}','${t.id}','${ids.student}','${p.id}',
  '${f.day}','${f.day}','${f.day}',400,'confirmed','${f.day}',now());
 insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount)
  values('${ids.batch}','${ids.lesson}',400);
 insert into public.profiles(id,display_name,last_role,enabled_roles,roles_configured)
  values('${t.id}','CI Teacher Correction','teacher',array['teacher']::text[],true)
  on conflict(id) do update set last_role=excluded.last_role,
  enabled_roles=excluded.enabled_roles,roles_configured=excluded.roles_configured;
 commit;`);
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({apiUrl,anonKey})=>{
  window.V4_LOCAL_BACKEND={environment:'local',isolated:true,projectRef:'local',
   url:apiUrl,publishableKey:anonKey};
 },{apiUrl:f.apiUrl,anonKey:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>Boolean(window.supabase?.createClient),{timeout:20000});
 await page.evaluate(async ({apiUrl,anonKey,email,password})=>{
  const client=window.supabase.createClient(apiUrl,anonKey,{auth:{
   persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error(error.message);
  client.auth.stopAutoRefresh?.();
 },{apiUrl:f.apiUrl,anonKey:f.anonKey,email:t.email,password:t.password});
 await page.reload();
 await expect(page.locator('#account-current')).toHaveText(t.email);
 await page.locator('.side-nav [data-view="billing"]').click();
 await expect(page.locator('#view-billing')).toBeVisible();
 const action=page.locator('[data-action="preview-correction"][data-id="'+ids.batch+'"]');
 await expect(action).toBeVisible();
 await action.click();
 await expect(page.locator('#correction-modal')).toBeVisible();
 await expect(page.locator('#correction-details')).toContainText('400');
 await page.locator('[data-correction-lesson="'+ids.lesson+'"]').fill('200');
 await page.locator('#correction-reason').fill('CI: Original confirmation was overstated and audited');
 await page.locator('#correction-submit').click();
 await expect(page.locator('#correction-confirmation')).toContainText('200');
 await page.locator('#correction-submit').click();
 await expect(page.locator('#correction-modal')).not.toBeVisible();
 assert.equal(db(`select coalesce(sum(i.amount),0)::numeric(12,2)
 from public.payment_batch_correction_items i
 join public.payment_batch_corrections c on c.id=i.correction_id
 where c.batch_id='${ids.batch}'`),'200.00');
 assert.equal(db(`select status from public.payment_batches where id='${ids.batch}'`),'confirmed');
 assert.equal(db(`select paid_amount::numeric(12,2) from public.payment_batches where id='${ids.batch}'`),'400.00');
 assert.equal(db(`select status from public.lesson_records where id='${ids.lesson}'`),'未付款');
 assert.equal(db(`select received_date is null from public.lesson_records where id='${ids.lesson}'`),'t');
 console.log(JSON.stringify({result:'PASS',syntheticTeacherJWT:true,original:400,
  auditedCorrection:200,netConfirmed:200,productionWrites:0}));
});
