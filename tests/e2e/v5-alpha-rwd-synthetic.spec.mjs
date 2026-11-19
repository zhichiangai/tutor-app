// Production Alpha visual regression evidence, using disposable localhost GoTrue only.
// This test must never navigate Google or access Production URL/credentials.
// Report DOM geometry and synthetic screenshot artifacts; no OAuth callback URL output.
import {test,expect} from '@playwright/test';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';

if(process.env.V4_E2E_LOCAL!=='1')throw Error('Only disposable local E2E is permitted');
const file=process.env.V4_E2E_FIXTURE_FILE;
if(!file?.startsWith('/'))throw Error('Explicit absolute local QA fixture required');
const fixture=JSON.parse(readFileSync(file,'utf8'));
assert.equal(fixture.apiUrl,'http://127.0.0.1:54321');
assert.equal(fixture.baseUrl,'http://127.0.0.1:3000');
const widths=[320,375,390,430,768,1440],height=844;
const evidenceDir=fileURLToPath(new URL('./test-results/v4-e2e-artifacts/',import.meta.url));

async function localLogin(page,role){
 const actor=fixture.actors[role];
 assert.ok(actor,'Synthetic QA actor missing: '+role);
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({
   path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}
  }));
 await page.addInitScript(({apiUrl,anonKey})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url:apiUrl,publishableKey:anonKey
  };
 },{apiUrl:fixture.apiUrl,anonKey:fixture.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>Boolean(window.supabase?.createClient),{timeout:20_000});
 await page.evaluate(async ({apiUrl,anonKey,email,password})=>{
  const db=window.supabase.createClient(apiUrl,anonKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error)throw Error('Disposable local QA sign-in failed');
  db.auth.stopAutoRefresh?.();
 },{apiUrl:fixture.apiUrl,anonKey:fixture.anonKey,
   email:actor.email,password:actor.password});
 await page.evaluate(()=>localStorage.setItem('tutor_v4_explicit_logout','0'));
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await expect(page.locator('#account-current')).toHaveText(actor.email);
 if(role==='parent'){
  const current=await page.locator('#role-indicator-text').textContent();
  if(!current.includes('家長模式')){
   await page.locator('#role-indicator').click();
   await page.locator('#role-menu [data-role-choice="parent"]').click();
   await expect(page.locator('#role-indicator-text')).toContainText('家長模式');
  }
 }
 if(role==='student')await expect(page.locator('body')).toHaveClass(/student-mode/);
}

async function openReadOnlySection(page,role){
 const target=role==='student'?'student-calendar':role==='team'?'projects':'calendar';
 const desktop=role==='team'?
  page.locator('.side-nav [data-team-section="projects"]'):
  page.locator('.side-nav [data-view="'+target+'"]');
 const mobile=role==='team'?
  page.locator('.mobile-nav [data-team-section="projects"]'):
  page.locator('.mobile-nav [data-view="'+target+'"]');
 if(await desktop.isVisible())await desktop.click();
 else {
  await expect(mobile).toBeVisible();
  await mobile.click();
 }
 await expect(page.locator(role==='student'?'#view-student':
  role==='team'?'#view-settings':'#view-calendar')).toBeVisible();
}

async function assertViewport(page,role,width){
 await page.setViewportSize({width,height});
 if(role==='teacher'||role==='parent'||role==='student'||role==='team'){
  await openReadOnlySection(page,role);
 }
 const metrics=await page.evaluate(()=>{
  const root=document.documentElement;
  const body=document.body;
  return {
   viewport:window.innerWidth,
   rootScrollWidth:root.scrollWidth,
   bodyScrollWidth:body.scrollWidth,
   rootClientWidth:root.clientWidth,
   horizontalScroll:window.scrollX,
   navVisible:[...document.querySelectorAll('.side-nav,.mobile-nav')]
    .some(n=>n.getBoundingClientRect().width>0&&getComputedStyle(n).visibility!=='hidden')
  };
 });
 // In Playwright a viewport screenshot may crop legitimately. This DOM assertion
 // distinguishes actual horizontal page overflow from screenshot-tool clipping.
 expect(metrics.viewport).toBe(width);
 expect(metrics.navVisible).toBe(true);
 if(metrics.rootScrollWidth>metrics.rootClientWidth+2||
    metrics.bodyScrollWidth>metrics.viewport+2){
  // Do not log URLs, sessions or private text; only UI layout measurements.
  console.log('RWD_GEOMETRY',JSON.stringify({role,width,...metrics}));
 }
 expect(metrics.rootScrollWidth,'Actual root horizontal overflow: '+role+' '+width)
  .toBeLessThanOrEqual(metrics.rootClientWidth+2);
 expect(metrics.bodyScrollWidth,'Actual body horizontal overflow: '+role+' '+width)
  .toBeLessThanOrEqual(metrics.viewport+2);
 // The fixture has only synthetic account/course data. Screenshot stores no
 // Google or Production OAuth URLs because this flow never uses OAuth.
 mkdirSync(evidenceDir,{recursive:true});
 await page.screenshot({path:join(evidenceDir,'v5-alpha-rwd-'+role+'-'+width+'.png'),
  animations:'disabled',caret:'hide'});
}

for(const role of ['teacher','parent','student']){
 test('synthetic '+role+' 320/375/390/430/768/1440 RWD navigation and overflow',async({page})=>{
  test.setTimeout(150_000);
  await localLogin(page,role);
  for(const width of widths)await assertViewport(page,role,width);
 });
}

test('synthetic Team settings and project navigation across six viewports',async({page})=>{
 test.setTimeout(150_000);
 await localLogin(page,'teacher');
 await page.locator('#account-action').click();
 await expect(page.locator('#workspace-mode-card')).toBeVisible();
 const mode=page.locator('#workspace-mode-card [data-workspace-mode="team"]');
 if(await mode.getAttribute('aria-pressed')!=='true')await mode.click();
 await expect(page.locator('body')).toHaveClass(/teacher-team-workspace/);
 for(const width of widths)await assertViewport(page,'team',width);
});


async function assertReadableDialog(page,selector,width,buttonSelector){
 const dialog=page.locator(selector);
 await expect(dialog).toBeVisible();
 // A tall dialog can scroll vertically. Its horizontal edges must remain
 // inside the viewport, with no sideways content scroll.
 const rect=await dialog.evaluate(el=>{
  const r=el.getBoundingClientRect();
  return {left:r.left,right:r.right,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth};
 });
 expect(rect.left,selector+' clipped at left edge for '+width).toBeGreaterThanOrEqual(-2);
 expect(rect.right,selector+' clipped at right edge for '+width).toBeLessThanOrEqual(width+2);
 expect(rect.scrollWidth,selector+' has internal horizontal overflow for '+width)
  .toBeLessThanOrEqual(rect.clientWidth+2);
 const button=page.locator(buttonSelector);
 await expect(button).toBeVisible();
 // Trial click proves the actual interactive surface can be reached without
 // submitting any synthetic form, rather than only appearing in the DOM.
 await button.click({trial:true,timeout:10_000});
 mkdirSync(evidenceDir,{recursive:true});
 await page.screenshot({path:join(evidenceDir,
  'v58-teacher-overlay-'+selector.replace(/[^a-z0-9]/gi,'')+'-'+width+'.png'),
  animations:'disabled',caret:'hide'});
}

test('synthetic teacher lesson and recurring schedule overlays fit all six viewport widths',async({page})=>{
 test.setTimeout(210_000);
 await localLogin(page,'teacher');
 for(const width of widths){
  await page.setViewportSize({width,height});
  await openReadOnlySection(page,'teacher');
  // The disposable fixture seeds this lesson on the current Taipei date.
  // <=650px: compact month cells hide event chips and expose the daily agenda.
  // >650px: the lower agenda is intentionally hidden; use the month event chip.
  await page.locator('#jump-today').click();
  await expect(page.locator('#calendar-grid .calendar-cell[data-day="'+fixture.day+'"]')).toBeVisible();
  const entry=width<=650?
   '#agenda-list .day-lesson-open[data-action="open-lesson"][data-id="'+fixture.ids.lesson+'"]':
   '#calendar-grid .calendar-event[data-action="open-lesson"][data-id="'+fixture.ids.lesson+'"]';
  const lesson=page.locator(entry);
  await expect(lesson).toBeVisible();
  await lesson.click();
  await expect(page.locator('#lesson-teacher-readonly')).toBeVisible();
  await assertReadableDialog(page,'#lesson-modal',width,'#lesson-open-editor');
  await page.locator('#lesson-open-editor').click();
  await expect(page.locator('#lesson-teacher-actions')).toBeVisible();
  // The shared synthetic fixture may already have receipts from earlier
  // E2E flows. Payment-locked lessons must block time/amount edits while
  // keeping the separate learning feedback action accessible.
  const paymentLocked=await page.locator('#lesson-save').isDisabled();
  if(paymentLocked){
   await expect(page.locator('#lesson-save')).toBeDisabled();
   await expect(page.locator('#lesson-learning-save')).toBeEnabled();
  }
  await assertReadableDialog(page,'#lesson-modal',width,
   paymentLocked?'#lesson-learning-save':'#lesson-save');
  await page.locator('#lesson-modal [data-close="lesson-modal"]').click();
  await expect(page.locator('#lesson-modal')).not.toBeVisible();

  await page.locator('#manage-schedules').click();
  await expect(page.locator('#schedule-manage-view')).toBeVisible();
  await assertReadableDialog(page,'#schedule-modal',width,'#schedule-create-new');
  await page.locator('#schedule-create-new').click();
  await expect(page.locator('#schedule-editor-fields')).toBeVisible();
  await assertReadableDialog(page,'#schedule-modal',width,'#schedule-save');
  await page.locator('#schedule-modal [data-close="schedule-modal"]').click();
  await expect(page.locator('#schedule-modal')).not.toBeVisible();
 }
});
