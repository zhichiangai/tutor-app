// RAP-49 eight-actor isolated GUI. All accounts and backend are disposable.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.equal(process.env.RAP12_TEAM_GUI_LOCAL,'1');
assert.equal(process.env.RAP49_STUDENT_LOCAL,'1');
const fixture=JSON.parse(readFileSync(process.env.RAP12_FIXTURE_FILE,'utf8'));
assert.equal(fixture.apiUrl,'http://127.0.0.1:54321');
assert.equal(fixture.baseUrl,'http://127.0.0.1:3000');
const ids=Object.values(fixture.actors).map(x=>x.id);
assert.equal(ids.length,8);
assert.equal(new Set(ids).size,8);

async function login(page,role){
 await page.goto('/__rap12/');
 await page.locator('button[data-role="'+role+'"]').click();
 await expect(page).toHaveURL(/\/v2\/index\.html/);
 await expect(page.locator('body')).not.toHaveClass(/login-required/);
 await expect(page.locator('#account-current')).toHaveText(fixture.actors[role].email);
}
async function studentView(page){
 if(!await page.locator('body').evaluate(el=>el.classList.contains('student-mode'))){
  const trigger=page.locator('#role-indicator');
  await trigger.click();
  await page.locator('#role-menu [data-role-choice="student"]').click();
 }
 await expect(page.locator('body')).toHaveClass(/student-mode/);
 const nav=page.locator('.mobile-nav [data-view="student-learning"]');
 const target=await nav.isVisible()?nav:
  page.locator('.side-nav [data-view="student-learning"]');
 await target.click();
 await expect(page.locator('#student-learning-panel')).toBeVisible();
 await expect(page.locator('#v5-team-student-learning-card')).toBeVisible();
}
async function checkLesson(page,wanted,forbidden){
 const list=page.locator('#v5-team-student-lesson-list');
 await expect(list).toContainText(wanted);
 for(const text of forbidden)await expect(list).not.toContainText(text);
 const contents=await list.innerText();
 for(const privateText of ['NT$','時薪','退款','銀行帳號','私人備註'])
  expect(contents).not.toContain(privateText);
 const width=await page.evaluate(()=>({
  viewport:document.documentElement.clientWidth,
  scroll:document.documentElement.scrollWidth
 }));
 expect(width.scroll).toBeLessThanOrEqual(width.viewport);
}
async function logout(page){
 await page.locator('#account-action').click();
 await page.locator('#sign-out').click();
 await expect(page.locator('body')).toHaveClass(/login-required/);
}
test('D/E/H each see own Team lessons; first-login H accepts invite in teacher mode',async({browser})=>{
 test.setTimeout(140000);
 for(const width of [390,1440]){
  for(const [role,own,blocked] of [
   ['studentA1','RAP12 Shared Math',['RAP12 Private Science','RAP12 Foreign English']],
   ['studentA2','RAP12 Private Science',['RAP12 Shared Math','RAP12 Foreign English']]
  ]){
   const page=await browser.newPage({viewport:{width,height:844}});
   try{
    await login(page,role);
    await studentView(page);
    await checkLesson(page,own,blocked);
    await page.screenshot({path:test.info().outputPath(role+'-'+width+'.png'),
     fullPage:false,animations:'disabled'});
    await logout(page);
   }finally{await page.close()}
  }
  // H starts without a Team student link and sees the real pending invitation
  // in the generic Settings view before any Student-mode grant is present.
  if(width===390){
   const page=await browser.newPage({viewport:{width,height:844}});
   try{
    await login(page,'studentB');
    await expect(page.locator('body')).not.toHaveClass(/student-mode/);
    await page.locator('#account-action').click();
    await expect(page.locator('#v5-student-auth-card')).toBeVisible();
    await expect(page.locator('#v5-student-auth-invitations')).toContainText('RAP12 Beta Student');
    await page.locator('#v5-student-auth-invitations [data-v5-student-action="accept"]').click();
    await expect(page.locator('body')).toHaveClass(/student-mode/);
    await studentView(page);
    await checkLesson(page,'RAP12 Foreign English',
     ['RAP12 Shared Math','RAP12 Private Science']);
    await page.screenshot({path:test.info().outputPath('studentB-first-accept-390.png'),
     fullPage:false,animations:'disabled'});
    await logout(page);
   }finally{await page.close()}
  }else{
   const page=await browser.newPage({viewport:{width,height:844}});
   try{
    await login(page,'studentB');
    await studentView(page);
    await checkLesson(page,'RAP12 Foreign English',
     ['RAP12 Shared Math','RAP12 Private Science']);
    await page.screenshot({path:test.info().outputPath('studentB-1440.png'),
     fullPage:false,animations:'disabled'});
    await logout(page);
   }finally{await page.close()}
  }
 }
});
test('Team manager sees only their own student links and teachers cannot invite',async({browser})=>{
 test.setTimeout(75000);
 const a=await browser.newPage({viewport:{width:390,height:844}});
 const teacher=await browser.newPage({viewport:{width:390,height:844}});
 try{
  await login(a,'managerA');
  await a.locator('#account-action').click();
  const mode=a.locator('#workspace-mode-card [data-workspace-mode="team"]');
  if(await mode.getAttribute('aria-pressed')!=='true')await mode.click();
  const nav=a.locator('.mobile-nav [data-team-section="learning"]');
  await nav.click();
  await expect(a.locator('#v5-student-auth-admin-card')).toBeVisible();
  await expect(a.locator('#v5-student-auth-admin-links')).toContainText('RAP12 Alpha Student');
  await expect(a.locator('#v5-student-auth-admin-links')).toContainText('RAP12 Private Student');
  await expect(a.locator('#v5-student-auth-admin-links')).not.toContainText('RAP12 Beta Student');
  await login(teacher,'teacherA');
  await teacher.locator('#account-action').click();
  const teachMode=teacher.locator('#workspace-mode-card [data-workspace-mode="team"]');
  if(await teachMode.getAttribute('aria-pressed')!=='true')await teachMode.click();
  await teacher.locator('.mobile-nav [data-team-section="learning"]').click();
  await expect(teacher.locator('#v5-student-auth-admin-card')).toBeHidden();
 }finally{
  await a.close();await teacher.close();
 }
});
