// RAP-12 browser GUI on three independent disposable GoTrue identities.
// Never opens a Production hostname, sends financial writes, or logs credentials.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.equal(process.env.RAP12_TEAM_GUI_LOCAL,'1');
const path=process.env.RAP12_FIXTURE_FILE;
assert.ok(path&&isAbsolute(path),'Disposable absolute fixture required');
const f=JSON.parse(readFileSync(path,'utf8'));
assert.equal(f.environment,'local');
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
assert.notEqual(f.actors.managerA.id,f.actors.teacherA.id);
assert.notEqual(f.actors.managerA.id,f.actors.managerB.id);

async function login(page,role){
 const actor=f.actors[role];
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.76.1/dist/umd/supabase.js',
  route=>route.fulfill({
   path:'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
   contentType:'text/javascript',headers:{'access-control-allow-origin':'*'}
  }));
 await page.addInitScript(({url,key})=>{
  window.V4_LOCAL_BACKEND={
   environment:'local',isolated:true,projectRef:'local',url,publishableKey:key
  };
 },{url:f.apiUrl,key:f.anonKey});
 await page.goto('/v2/index.html');
 await page.waitForFunction(()=>Boolean(window.supabase?.createClient),{timeout:20000});
 await page.evaluate(async ({url,key,email,password})=>{
  const client=window.supabase.createClient(url,key,{
   auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Disposable-local synthetic sign-in failed');
  client.auth.stopAutoRefresh?.();
 },{url:f.apiUrl,key:f.anonKey,email:actor.email,password:actor.password});
 await page.evaluate(()=>localStorage.setItem('tutor_v4_explicit_logout','0'));
 await page.reload();
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await expect(page.locator('#account-current')).toHaveText(actor.email);
}
async function teamSection(page,section){
 const navMobile=page.locator('.mobile-nav .nav-team[data-team-section="'+section+'"]');
 const navDesktop=page.locator('.side-nav .nav-team[data-team-section="'+section+'"]');
 const target=await navMobile.isVisible()?navMobile:navDesktop;
 await expect(target).toBeVisible();
 await target.click();
 await expect(page.locator('#view-settings')).toBeVisible();
}
async function enterTeam(page){
 await page.locator('#account-action').click();
 const mode=page.locator('#workspace-mode-card [data-workspace-mode="team"]');
 await expect(mode).toBeVisible();
 if(await mode.getAttribute('aria-pressed')!=='true')await mode.click();
 await expect(page.locator('body')).toHaveClass(/teacher-team-workspace/);
}
async function logout(page){
 await page.locator('#account-action').click();
 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
}
async function inspectManagerA(page,testInfo,width){
 await login(page,'managerA');
 await enterTeam(page);
 await teamSection(page,'projects');
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-owner-controls')).toBeVisible();
 await expect(page.locator('#v5-team-role-scope')).toContainText('現任 Team 管理者');
 await page.locator('#v5-team-manage-select').selectOption(f.ids.wsA);
 await expect(page.locator('#v5-team-project-list')).toContainText('RAP12 Alpha Shared');
 await expect(page.locator('#v5-team-project-list')).toContainText('RAP12 Alpha Manager Only');
 await expect(page.locator('#v5-team-project-list')).not.toContainText('RAP12 Beta Foreign');
 await teamSection(page,'learning');
 await expect(page.locator('#v5-learning-manager-controls')).toBeVisible();
 await page.locator('#v5-learning-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-learning-project-select')).toBeVisible();
 await teamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-billing-confirmed')).toContainText('RAP12 Shared Math');
 await page.screenshot({path:testInfo.outputPath('managerA-'+width+'.png'),animations:'disabled'});
 await logout(page);
}
async function inspectTeacherA(page,testInfo,width){
 await login(page,'teacherA');
 await enterTeam(page);
 await teamSection(page,'projects');
 await expect(page.locator('#v5-team-card')).toBeVisible();
 await expect(page.locator('#v5-team-role-scope')).toContainText('Team 一般老師');
 await expect(page.locator('#v5-team-owner-controls')).toBeHidden();
 await expect(page.locator('#v5-team-project-list')).toContainText('RAP12 Alpha Shared');
 await expect(page.locator('#v5-team-project-list')).not.toContainText('RAP12 Alpha Manager Only');
 await expect(page.locator('#v5-team-project-list')).not.toContainText('RAP12 Beta Foreign');
 await teamSection(page,'learning');
 await expect(page.locator('#v5-learning-manager-controls')).toBeHidden();
 const ids=await page.locator('#v5-learning-team-select option').evaluateAll(
  options=>options.map(x=>x.value));
 assert.ok(ids.includes(f.ids.teamA));
 assert.ok(!ids.includes(f.ids.teamB));
 await page.locator('#v5-learning-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-learning-lessons')).toContainText('RAP12 Shared Math');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Private Science');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Foreign English');
 await teamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeHidden();
 await page.screenshot({path:testInfo.outputPath('teacherA-'+width+'.png'),animations:'disabled'});
 await logout(page);
}
async function inspectManagerB(page,testInfo,width){
 await login(page,'managerB');
 await enterTeam(page);
 await teamSection(page,'projects');
 await expect(page.locator('#v5-team-owner-controls')).toBeVisible();
 await page.locator('#v5-team-manage-select').selectOption(f.ids.wsB);
 await expect(page.locator('#v5-team-project-list')).toContainText('RAP12 Beta Foreign');
 await expect(page.locator('#v5-team-project-list')).not.toContainText('RAP12 Alpha Shared');
 await page.screenshot({path:testInfo.outputPath('managerB-'+width+'.png'),animations:'disabled'});
 await logout(page);
}
for(const width of [390,1440]){
 test('RAP-12 isolated distinct Team manager, assigned teacher and foreign manager '+width+'px',async({browser},testInfo)=>{
  test.setTimeout(150000);
  for(const [role,inspect] of [
   ['managerA',inspectManagerA],['teacherA',inspectTeacherA],['managerB',inspectManagerB]
  ]){
   // browser.newPage creates a separate BrowserContext for each identity.
   // Do not reuse one user's localStorage to imitate a different account.
   const page=await browser.newPage({viewport:{width,height:844}});
   try{await inspect(page,testInfo,width)}
   finally{await page.close()}
  }
 });
}
