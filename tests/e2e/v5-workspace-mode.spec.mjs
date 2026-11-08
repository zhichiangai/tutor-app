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
 await page.locator('.side-nav [data-view="settings"]').click();
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
   await expect(page.locator('body')).not.toHaveClass(/teacher-team-workspace/);
   if(role==='student'){
    await expect(page.locator('body')).toHaveClass(/student-mode/);
    await page.locator('.side-nav [data-view="student-calendar"]').click();
    await expect(page.locator('#view-student')).toBeVisible();
   }else{
    await page.locator('.side-nav [data-view="settings"]').click();
    await expect(page.locator('#workspace-mode-card')).toBeHidden();
    await page.locator('.side-nav [data-view="billing"]').click();
    await expect(page.locator('#view-billing')).toBeVisible();
   }
  }finally{await page.close()}
 }
});
