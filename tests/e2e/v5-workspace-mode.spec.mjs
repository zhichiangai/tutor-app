// V5 personal vs Team mode is a UI preference, not an RLS grant.
// Uses disposable localhost Auth/PostgREST only. Never contacts Production.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
if(process.env.V4_E2E_LOCAL!=='1')throw Error('V4_E2E_LOCAL=1 required');
const path=process.env.V4_E2E_FIXTURE_FILE;
if(!path?.startsWith('/'))throw Error('Absolute disposable fixture required');
const f=JSON.parse(readFileSync(path,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
async function signIn(page,role){
 const actor=f.actors[role];
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}}));
 await page.addInitScript(({apiUrl,anonKey})=>{
  window.V4_LOCAL_BACKEND={environment:'local',isolated:true,projectRef:'local',url:apiUrl,publishableKey:anonKey};
 },{apiUrl:f.apiUrl,anonKey:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>Boolean(window.supabase?.createClient),{timeout:20_000});
 await page.evaluate(async ({apiUrl,anonKey,email,password})=>{
  const client=window.supabase.createClient(apiUrl,anonKey,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Synthetic sign-in failed: '+error.message);
  client.auth.stopAutoRefresh?.();
 },{apiUrl:f.apiUrl,anonKey:f.anonKey,email:actor.email,password:actor.password});
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await expect(page.locator('#account-current')).toHaveText(actor.email);
}
test('teacher changes workspace in Settings and V4 personal navigation remains available',async({page})=>{
 await signIn(page,'teacher');
 await expect(page.locator('body')).toHaveClass(/teacher-personal-workspace/);
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await expect(page.locator('#workspace-mode-card')).toBeVisible();
 await page.locator('[data-workspace-mode="team"]').click();
 await expect(page.locator('body')).toHaveClass(/teacher-team-workspace/);
 await expect(page.locator('.side-nav [data-view="calendar"]')).toBeHidden();
 await expect(page.locator('.side-nav [data-team-section="projects"]')).toBeVisible();
 await expect(page.locator('#view-calendar')).toBeHidden();
 await page.locator('.side-nav [data-team-section="learning"]').click();
 await expect(page.locator('#settings-page-title')).toHaveText('Team 學生與課表');
 await page.locator('.side-nav [data-team-section="billing"]').click();
 await expect(page.locator('#settings-page-title')).toHaveText('Team 帳務');
 await page.locator('#account-action').click();
 await expect(page.locator('#settings-page-title')).toHaveText('設定');
 await page.reload();
 await expect(page.locator('body')).toHaveClass(/teacher-team-workspace/);
 await page.locator('.side-nav [data-team-section="settings"]').click();
 await page.locator('[data-workspace-mode="personal"]').click();
 await expect(page.locator('body')).toHaveClass(/teacher-personal-workspace/);
 await page.locator('.side-nav [data-view="calendar"]').click();
 await expect(page.locator('#view-calendar')).toBeVisible();
 await page.locator('.side-nav [data-view="billing"]').click();
 await expect(page.locator('#view-billing')).toBeVisible();
});
test('parent and student keep legacy role navigation without Team switch',async({browser})=>{
 for(const role of ['parent','student']){
  const page=await browser.newPage();
  try{
   await signIn(page,role);
   // Earlier Team governance tests legitimately enable teacher mode on this
   // synthetic parent account. Select its parent role explicitly before
   // asserting parent-only navigation; mode is not a database permission.
   if(role==='parent'&&
     !(await page.locator('#role-indicator-text').textContent()).includes('家長模式')){
    await page.locator('#role-indicator').click();
    await page.locator('#role-menu [data-role-choice="parent"]').click();
    await expect(page.locator('#role-indicator-text')).toContainText('家長模式');
   }
   await expect(page.locator('body')).not.toHaveClass(/teacher-team-workspace/);
   if(role==='student'){
    await expect(page.locator('body')).toHaveClass(/student-mode/);
    await page.locator('.side-nav [data-view="student-calendar"]').click();
    await expect(page.locator('#view-student')).toBeVisible();
   }else{
    await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
    await expect(page.locator('#workspace-mode-card')).toBeHidden();
    await page.locator('.side-nav [data-view="billing"]').click();
    await expect(page.locator('#view-billing')).toBeVisible();
   }
  }finally{await page.close()}
 }
});

test('320/375/390/430 mobile workspace switch keeps distinct personal and Team tabs',async({browser})=>{
 for(const width of [320,375,390,430]){
  const page=await browser.newPage({viewport:{width,height:760}});
  try{
   await signIn(page,'teacher');
   await page.locator('.mobile-nav .nav-standard[data-view="settings"]').click();
   await expect(page.locator('#workspace-mode-card')).toBeVisible();
   await page.locator('#workspace-mode-card [data-workspace-mode="team"]').click();
   await expect(page.locator('.mobile-nav .nav-team[data-team-section="projects"]')).toBeVisible();
   await expect(page.locator('.mobile-nav .nav-standard[data-view="billing"]')).toBeHidden();
   await page.locator('.mobile-nav .nav-team[data-team-section="learning"]').click();
   await expect(page.locator('#settings-page-title')).toHaveText('Team 學生與課表');
   await page.locator('.mobile-nav .nav-team[data-team-section="settings"]').click();
   await page.locator('#workspace-mode-card [data-workspace-mode="personal"]').click();
   await expect(page.locator('.mobile-nav .nav-standard[data-view="calendar"]')).toBeVisible();
   await page.locator('.mobile-nav .nav-standard[data-view="calendar"]').click();
   await expect(page.locator('#view-calendar')).toBeVisible();
  }finally{await page.close()}
 }
});

test('V5.5.1 mobile parent/student role isolation, no Team switch or student financial data',async({browser})=>{
 for(const width of [320,375,390,430]){
  for(const role of ['parent','student']){
   const page=await browser.newPage({viewport:{width,height:760}});
   try{
    await signIn(page,role);
    if(role==='parent'&&
      !(await page.locator('#role-indicator-text').textContent()).includes('家長模式')){
     await page.locator('#role-indicator').click();
     await page.locator('#role-menu [data-role-choice="parent"]').click();
     await expect(page.locator('#role-indicator-text')).toContainText('家長模式');
    }
    await expect(page.locator('body')).not.toHaveClass(/teacher-team-workspace/);
    await expect(page.locator('.mobile-nav .nav-team[data-team-section="projects"]')).toBeHidden();
    await expect(page.locator('.mobile-nav .nav-team[data-team-section="billing"]')).toBeHidden();
    if(role==='parent'){
     await expect(page.locator('.mobile-nav .nav-standard[data-view="billing"]')).toBeVisible();
     await expect(page.locator('.mobile-nav .nav-student[data-view="student-calendar"]')).toBeHidden();
     await page.locator('.mobile-nav .nav-standard[data-view="settings"]').click();
     await expect(page.locator('#workspace-mode-card')).toBeHidden();
     await page.locator('.mobile-nav .nav-standard[data-view="billing"]').click();
     await expect(page.locator('#view-billing')).toBeVisible();
    }else{
     await expect(page.locator('body')).toHaveClass(/student-mode/);
     await expect(page.locator('.mobile-nav .nav-standard[data-view="billing"]')).toBeHidden();
     for(const [view,panel] of [
      ['student-today','student-today-panel'],
      ['student-calendar','student-calendar-panel'],
      ['student-learning','student-learning-panel']
     ]){
      await page.locator('.mobile-nav .nav-student[data-view="'+view+'"]').click();
      await expect(page.locator('#'+panel)).toBeVisible();
      await expect(page.locator('#'+panel)).not.toContainText('NT$');
     }
     await page.locator('.mobile-nav .nav-student[data-view="settings"]').click();
     await expect(page.locator('#workspace-mode-card')).toBeHidden();
    }
    const widths=await page.evaluate(()=>({
     viewport:document.documentElement.clientWidth,
     page:document.documentElement.scrollWidth
    }));
    expect(widths.page,role+' mobile viewport '+width+' must not overflow horizontally')
     .toBeLessThanOrEqual(widths.viewport);
    // The sign-out action belongs to Settings, never the billing view.
    if(role==='parent')await page.locator('.mobile-nav .nav-standard[data-view="settings"]').click();
    await page.locator('#sign-out').click();
    await expect(page.locator('body')).toHaveClass(/login-required/);
    await expect(page.locator('#workspace-mode-card')).toBeHidden();
   }finally{
    await page.close();
   }
  }
 }
});

// QA-TEAM-01: a missing Production-style Team RPC must never masquerade
// as a legitimate, empty-but-loaded Team project list.
test('missing V5 Team backend shows explicit unavailable state, not empty projects',async({page})=>{
 await signIn(page,'teacher');
 await page.route('**/rest/v1/rpc/v5_my_plan',route=>route.fulfill({
  status:404,contentType:'application/json',
  body:JSON.stringify({code:'PGRST202',
   message:'Could not find the function public.v5_my_plan in the schema cache'})
 }));
 await page.locator('.side-nav .nav-standard[data-view="settings"]').click();
 await page.locator('#workspace-mode-card [data-workspace-mode="team"]').click();
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-message')).toContainText('Team 資料庫尚未啟用');
 await expect(page.locator('#v5-team-project-list')).toBeEmpty();
 await expect(page.locator('#v5-team-owner-controls')).toBeHidden();
 await expect(page.locator('#v5-team-card')).not.toContainText('目前沒有可查看的 Team 專案');
 await page.locator('.side-nav [data-team-section="settings"]').click();
 await page.locator('#workspace-mode-card [data-workspace-mode="personal"]').click();
 await page.locator('.side-nav .nav-standard[data-view="calendar"]').click();
 await expect(page.locator('#view-calendar')).toBeVisible();
});
