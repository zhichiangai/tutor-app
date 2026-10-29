// Real Chromium E2E against disposable localhost Supabase; NO hosted credentials.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

if(process.env.V4_E2E_LOCAL!=='1')throw Error('V4_E2E_LOCAL=1 required');
const fixturePath=process.env.V4_E2E_FIXTURE_FILE;
if(!fixturePath?.startsWith('/'))throw Error('Absolute fixture file in runner temp is required');
const f=JSON.parse(readFileSync(fixturePath,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
function db(query){
 return execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql',
 '-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',query],
 {encoding:'utf8'}).trim();
}
async function login(page,role){
 const actor=f.actors[role];
 // Keep the test self-contained: serve the pinned local UMD bundle instead
 // of requiring a live third-party CDN during each browser test.
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
   route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
    contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({apiUrl,anonKey})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',
   url:apiUrl,publishableKey:anonKey
  };
 },{apiUrl:f.apiUrl,anonKey:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>Boolean(window.supabase?.createClient),{timeout:20_000});
 await page.evaluate(async ({apiUrl,anonKey,email,password})=>{
  const client=window.supabase.createClient(apiUrl,anonKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Local synthetic login failed: '+error.message);
  client.auth.stopAutoRefresh?.();
 },{apiUrl:f.apiUrl,anonKey:f.anonKey,email:actor.email,password:actor.password});
 // The real app's existing client will discover the persisted local GoTrue session.
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await expect(page.locator('#account-current')).toHaveText(actor.email);
 await expect(page.locator('#connection-status')).toContainText('已登入');
}
async function navigate(page,view){
 await page.locator('.side-nav [data-view="'+view+'"]').click();
 await expect(page.locator('#view-'+(view.startsWith('student-')?'student':view))).toBeVisible();
}
async function submitAmount(page,amount,lessonDay=f.day){
 await navigate(page,'billing');
 await page.locator('#batch-action').click();
 await expect(page.locator('#period-modal')).toBeVisible();
 await page.locator('#period-student').selectOption(f.ids.student);
 await page.locator('#period-start').fill(lessonDay);
 await page.locator('#period-end').fill(lessonDay);
 await page.locator('#period-start').dispatchEvent('change');
 await page.locator('#period-paid-on').fill(f.day);
 await page.locator('#period-paid-amount').fill(String(amount));
 await expect(page.locator('#period-submit')).toBeEnabled();
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#period-submit').click();
 await expect(page.locator('#period-modal')).not.toBeVisible();
}
test('teacher ledger excludes QA lesson from official summary',async ({page})=>{
 await login(page,'teacher');
 await navigate(page,'billing');
 await expect(page.locator('#billing-summary')).toContainText('NT$ 1,000');
 await expect(page.locator('#billing-summary')).not.toContainText('NT$ 1,500');
 await expect(page.locator('#qa-accounting-control')).toBeVisible();
 await page.locator('#qa-accounting-toggle').check();
 await expect(page.locator('#billing-list')).toContainText('CI QA Student');
 await expect(page.locator('#billing-summary')).toContainText('NT$ 1,000');
 await expect(page.locator('#billing-summary')).not.toContainText('NT$ 1,500');
});
test('parent reports 600, teacher confirms, parent reports 400; no excess',async ({browser})=>{
 const p=await browser.newPage({timezoneId:'Asia/Taipei'});
 const t=await browser.newPage({timezoneId:'Asia/Taipei'});
 try{
  await login(p,'parent');
  await submitAmount(p,600);
  const pending=db("select count(*) from public.payment_batches where parent_id='"+f.actors.parent.id+"' and status='pending'");
  expect(pending).toBe('1');
  expect(db("select coalesce(sum(allocated_amount),0)::numeric(12,2) from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id where b.parent_id='"+f.actors.parent.id+"'")).toBe('600.00');
  await login(t,'teacher');
  await navigate(t,'billing');
  await expect(t.locator('#payment-batch-history [data-action="confirm-batch"]')).toHaveCount(1);
  await t.locator('#payment-batch-history [data-action="confirm-batch"]').click();
  await expect(t.locator('#receipt-modal')).toBeVisible();
  await t.locator('#receipt-date').fill(f.day);
  await t.locator('#receipt-form button[type="submit"]').click();
  await expect(t.locator('#receipt-modal')).not.toBeVisible();
  expect(db("select count(*) from public.payment_batches where parent_id='"+f.actors.parent.id+"' and status='confirmed'")).toBe('1');
  await p.reload();
  await submitAmount(p,400);
  expect(db("select count(*) from public.payment_batches where parent_id='"+f.actors.parent.id+"'")).toBe('2');
  expect(db("select sum(allocated_amount)::numeric(12,2) from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id where b.parent_id='"+f.actors.parent.id+"'")).toBe('1000.00');
  await p.reload();
  await navigate(p,'billing');
  await p.locator('#batch-action').click();
  await p.locator('#period-start').fill(f.day);
  await p.locator('#period-end').fill(f.day);
  await p.locator('#period-start').dispatchEvent('change');
  await expect(p.locator('#period-submit')).toBeDisabled();
 }finally{await Promise.all([p.close(),t.close()]);}
});
test('student mobile navigation never exposes financial information',async ({page})=>{
 await page.setViewportSize({width:320,height:740});
 await login(page,'student');
 await expect(page.locator('#role-indicator-text')).toContainText('同學');
 for(const [view,panel] of [['student-today','student-today-panel'],['student-calendar','student-calendar-panel'],['student-learning','student-learning-panel']]){
  await page.locator('.mobile-nav [data-view="'+view+'"]').click();
  await expect(page.locator('#'+panel)).toBeVisible();
  await expect(page.locator('#'+panel)).not.toContainText('NT$');
 }
 const dims=await page.evaluate(()=>({viewport:document.documentElement.clientWidth,
  scroll:document.documentElement.scrollWidth}));
 expect(dims.scroll).toBeLessThanOrEqual(dims.viewport);
 await page.locator('.mobile-nav .nav-student[data-view="settings"]').click();
 await expect(page.locator('#view-settings')).toBeVisible();
 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
});
test('unlinked other parent cannot see the synthetic child or billing',async ({page})=>{
 await login(page,'stranger');
 await navigate(page,'billing');
 await expect(page.locator('#billing-summary')).not.toContainText('NT$ 1,000');
 await navigate(page,'students');
 await expect(page.locator('#student-grid')).not.toContainText('CI Student');
});

test('historical QA-confirmed batch does not block genuine partial payments on the same lesson',async ({browser})=>{
 const lessonId=randomUUID(),qaBatchId=randomUUID();
 const prev=new Date(f.day+'T12:00:00Z');prev.setUTCDate(prev.getUTCDate()-1);
 const lessonDay=prev.toISOString().slice(0,10);
 db(`begin;
 insert into public.lesson_records
 (id,owner_id,student_id,lesson_date,type,hours,hourly_rate,total_amount,status)
 values ('${lessonId}','${f.actors.teacher.id}','${f.ids.student}','${lessonDay}',
 'lesson',2,500,1000,'老師已收到');
 insert into public.payment_batches
 (id,teacher_id,student_id,parent_id,period_start,period_end,paid_on,
 paid_amount,status,received_on,confirmed_at)
 values ('${qaBatchId}','${f.actors.teacher.id}','${f.ids.student}','${f.actors.parent.id}',
 '${lessonDay}','${lessonDay}','${lessonDay}',1000,'confirmed','${lessonDay}',now());
 insert into public.payment_batch_items(batch_id,lesson_id,allocated_amount)
 values('${qaBatchId}','${lessonId}',1000);
 commit;`);
 const t=await browser.newPage({timezoneId:'Asia/Taipei'});
 const p=await browser.newPage({timezoneId:'Asia/Taipei'});
 try{
  await login(t,'teacher');
  await t.evaluate(async ({apiUrl,key,batchId})=>{
   const client=window.supabase.createClient(apiUrl,key);
   const {error}=await client.from('v4_payment_batch_qa_marks').insert({
    batch_id:batchId,is_qa:true,classified_by:(await client.auth.getUser()).data.user.id,
    reason:'Synthetic batch was previously confirmed without any real bank transfer'
   });
   if(error)throw Error('QA classification failed: '+error.message);
  },{apiUrl:f.apiUrl,key:f.anonKey,batchId:qaBatchId});
  await login(p,'parent');
  await submitAmount(p,600,lessonDay);
  const first=db(`select b.id from public.payment_batches b
   join public.payment_batch_items i on i.batch_id=b.id
   where i.lesson_id='${lessonId}' and b.status='pending'
   order by b.created_at desc limit 1`);
  expect(first).toMatch(/^[0-9a-f-]{36}$/i);
  expect(db(`select sum(i.allocated_amount)::numeric(12,2) from public.payment_batch_items i
   where i.batch_id='${first}'`)).toBe('600.00');
  await t.reload();
  await navigate(t,'billing');
  await t.locator('[data-action="confirm-batch"][data-id="'+first+'"]').click();
  await expect(t.locator('#receipt-modal')).toBeVisible();
  await t.locator('#receipt-date').fill(f.day);
  await t.locator('#receipt-form button[type="submit"]').click();
  await expect(t.locator('#receipt-modal')).not.toBeVisible();
  expect(db(`select status from public.lesson_records where id='${lessonId}'`)).toBe('未付款');
  await p.reload();
  await submitAmount(p,400,lessonDay);
  const second=db(`select b.id from public.payment_batches b
   join public.payment_batch_items i on i.batch_id=b.id
   where i.lesson_id='${lessonId}' and b.status='pending'
   order by b.created_at desc limit 1`);
  expect(second).not.toBe(first);
  await t.reload();
  await navigate(t,'billing');
  await t.locator('[data-action="confirm-batch"][data-id="'+second+'"]').click();
  await t.locator('#receipt-date').fill(f.day);
  await t.locator('#receipt-form button[type="submit"]').click();
  await expect(t.locator('#receipt-modal')).not.toBeVisible();
  expect(db(`select status from public.lesson_records where id='${lessonId}'`)).toBe('老師已收到');
  expect(db(`select sum(i.allocated_amount)::numeric(12,2)
   from public.payment_batch_items i join public.payment_batches b on b.id=i.batch_id
   left join public.v4_payment_batch_qa_marks m on m.batch_id=b.id
   where i.lesson_id='${lessonId}' and b.status='confirmed'
     and coalesce(m.is_qa,false)=false`)).toBe('1000.00');
 }finally{await Promise.all([t.close(),p.close()]);}
});
