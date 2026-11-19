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
assert.notEqual(f.actors.teacherA.id,f.actors.managerB.id);

async function login(page,role){
 const actor=f.actors[role];
 // Use the exact same localhost-only role chooser available to Codex IAB.
 // No browser automation receives a real user password or external OAuth URL.
 await page.goto('/__rap12/');
 await expect(page.locator('h1')).toContainText('RAP-12');
 await page.locator('button[data-role="'+role+'"]').click();
 await expect(page).toHaveURL(/\/v2\/index\.html/);
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
// Screenshots are captured after the workspace-switch toast disappears.
// Full-page + card crops give Codex contextual and readable synthetic evidence.
// No Playwright trace, real OAuth, or production credentials are captured.
async function captureTeamEvidence(page,testInfo,role,width,section,cardSelector){
 await expect(page.locator('#toast')).toBeHidden({timeout:10000});
 const card=page.locator(cardSelector);
 await expect(card).toBeVisible();
 // Preserve high-detail full-page/card images at the two baseline widths.
 // Other mobile widths receive viewport evidence without duplicating huge pages.
 if(width!==390&&width!==1440)return;
 const filename=role+'-'+section+'-'+width;
 await page.screenshot({path:testInfo.outputPath(filename+'-page.png'),
  fullPage:true,animations:'disabled'});
 await card.screenshot({path:testInfo.outputPath(filename+'-card.png'),
  animations:'disabled'});
}
// A fullPage screenshot may visually place a fixed mobile bar over content even
// when a real user can scroll that content clear of the bar. Check the actual
// 390px *viewport* after scrolling to the final visible control in each card.
// This tests reachable geometry; it does not substitute for tap testing.
async function checkMobileNavClearance(page,testInfo,role,width,section,cardSelector){
 if(width>900)return;
 await expect(page.locator('#toast')).toBeHidden({timeout:10000});
 const outcome=await page.evaluate(async(selector)=>{
  const nav=document.querySelector('.mobile-nav');
  const card=document.querySelector(selector);
  if(!nav||!card)throw new Error('Missing Team navigation or card');
  const candidates=Array.from(card.querySelectorAll('button,input,select,textarea,a[href]'));
  const controls=candidates.filter(el=>{
   const r=el.getBoundingClientRect();
   return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';
  });
  const target=controls.at(-1)||card;
  const scrollRoot=document.documentElement;
  const previous=scrollRoot.style.scrollBehavior;
  scrollRoot.style.scrollBehavior='auto';
  try{
   const navRect=nav.getBoundingClientRect();
   const end=target.getBoundingClientRect().bottom+window.scrollY;
   const maximum=Math.max(0,scrollRoot.scrollHeight-window.innerHeight);
   const desired=Math.max(0,end-navRect.top+12);
   window.scrollTo(0,Math.min(desired,maximum));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const lower=nav.getBoundingClientRect();
   const rect=target.getBoundingClientRect();
   const x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2;
   const hit=(y>=0&&y<window.innerHeight)?
    document.elementFromPoint(x,y):null;
   return{
    navVisible:lower.width>0&&lower.height>0,
    navTop:lower.top,navHeight:lower.height,
    targetTop:rect.top,targetBottom:rect.bottom,
    targetUnobscured:rect.top>=0&&rect.bottom<=lower.top-8,
    targetHit:!!hit&&(hit===target||target.contains(hit)),
    scrollY:window.scrollY,maxScroll:maximum,
    docScrollWidth:scrollRoot.scrollWidth,docClientWidth:scrollRoot.clientWidth
   };
  }finally{scrollRoot.style.scrollBehavior=previous}
 },cardSelector);
 // Viewport-only screenshot (no fullPage) records the actual end-of-scroll state.
 await page.screenshot({path:testInfo.outputPath(role+'-'+section+'-'+width+'-viewport-bottom.png'),
  fullPage:false,animations:'disabled'});
 console.log('RAP12_MOBILE_NAV_CLEARANCE '+JSON.stringify({role,section,width,...outcome}));
 expect(outcome.navVisible).toBe(true);
 expect(outcome.docScrollWidth).toBeLessThanOrEqual(outcome.docClientWidth);
 expect(outcome.targetUnobscured,
  'Last visible Team control must be scrollable above the fixed mobile navigation').toBe(true);
 expect(outcome.targetHit,
  'Last visible Team control must not be covered by another DOM element').toBe(true);
}
// Billing's final refund disclaimer appears BELOW the last interactive button.
// Reachability of the button alone cannot prove every line of this copy is
// readable. Scroll to the document end in a real mobile viewport and check the
// entire note against fixed navigation; capture one viewport per mobile width.
async function checkBillingExplanatoryCopy(page,testInfo,width){
 if(width>900)return;
 const selector='#v56-adjustments-panel > p.helper-note:last-child';
 const note=page.locator(selector);
 await expect(note).toBeVisible();
 await expect(note).toContainText('銀行');
 const outcome=await page.evaluate(async(css)=>{
  const paragraph=document.querySelector(css);
  const nav=document.querySelector('.mobile-nav');
  if(!paragraph||!nav)throw new Error('Billing disclaimer/nav unavailable');
  const root=document.documentElement;
  const prev=root.style.scrollBehavior;
  root.style.scrollBehavior='auto';
  try{
   window.scrollTo(0,Math.max(0,root.scrollHeight-window.innerHeight));
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const r=paragraph.getBoundingClientRect();
   const n=nav.getBoundingClientRect();
   const x=(r.left+r.right)/2,y=r.bottom-2;
   const hit=y>=0&&y<window.innerHeight?document.elementFromPoint(x,y):null;
   return{
    copyTop:r.top,copyBottom:r.bottom,navTop:n.top,
    scrollY:window.scrollY,maxScroll:root.scrollHeight-window.innerHeight,
    fullCopyVisible:r.top>=0&&r.bottom<=n.top-8,
    bottomLineUncovered:!!hit&&(hit===paragraph||paragraph.contains(hit)),
    docScrollWidth:root.scrollWidth,docClientWidth:root.clientWidth
   };
  }finally{root.style.scrollBehavior=prev}
 },selector);
 await page.screenshot({path:testInfo.outputPath('managerA-billing-'+width+'-viewport-copy-end.png'),
  fullPage:false,animations:'disabled'});
 console.log('RAP12_BILLING_COPY_CLEARANCE '+JSON.stringify({width,...outcome}));
 expect(outcome.fullCopyVisible,'All billing disclaimer lines must clear fixed nav').toBe(true);
 expect(outcome.bottomLineUncovered,'The last billing disclaimer line cannot be overlaid').toBe(true);
 expect(outcome.docScrollWidth).toBeLessThanOrEqual(outcome.docClientWidth);
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
 await captureTeamEvidence(page,testInfo,'managerA',width,'projects','#v5-team-card');
 await checkMobileNavClearance(page,testInfo,'managerA',width,'projects','#v5-team-card');
 await teamSection(page,'learning');
 await expect(page.locator('#v5-learning-manager-controls')).toBeVisible();
 await page.locator('#v5-learning-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-learning-project-select')).toBeVisible();
 await expect(page.locator('#v5-learning-lessons')).toContainText('RAP12 Shared Math');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Foreign English');
 await expect(page.locator('#v5-learning-team-select option[value="'+f.ids.teamB+'"]')).toHaveCount(0);
 await captureTeamEvidence(page,testInfo,'managerA',width,'learning','#v5-learning-card');
 await checkMobileNavClearance(page,testInfo,'managerA',width,'learning','#v5-learning-card');
 await teamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeVisible();
 await page.locator('#v5-billing-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-billing-confirmed')).toContainText('RAP12 Shared Math');
 await captureTeamEvidence(page,testInfo,'managerA',width,'billing','#v5-billing-card');
 await checkMobileNavClearance(page,testInfo,'managerA',width,'billing','#v5-billing-card');
 await checkBillingExplanatoryCopy(page,testInfo,width);
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
 await captureTeamEvidence(page,testInfo,'teacherA',width,'projects','#v5-team-card');
 await checkMobileNavClearance(page,testInfo,'teacherA',width,'projects','#v5-team-card');
 await teamSection(page,'learning');
 await expect(page.locator('#v5-learning-manager-controls')).toBeHidden();
 // Team learning options are refreshed asynchronously from RLS-governed API calls.
 // Wait for the concrete permitted Team instead of reading the select before load finishes.
 await expect(page.locator('#v5-learning-team-select option[value="'+f.ids.teamA+'"]'))
  .toHaveCount(1);
 const ids=await page.locator('#v5-learning-team-select option').evaluateAll(
  options=>options.map(x=>x.value));
 assert.ok(ids.includes(f.ids.teamA));
 assert.ok(!ids.includes(f.ids.teamB));
 await page.locator('#v5-learning-team-select').selectOption(f.ids.teamA);
 await expect(page.locator('#v5-learning-lessons')).toContainText('RAP12 Shared Math');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Private Science');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Foreign English');
 await captureTeamEvidence(page,testInfo,'teacherA',width,'learning','#v5-learning-card');
 await checkMobileNavClearance(page,testInfo,'teacherA',width,'learning','#v5-learning-card');
 await teamSection(page,'billing');
 await expect(page.locator('#v5-billing-card')).toBeHidden();
 // The billing card is forbidden and hidden: document this through the
 // negative assertion, not by capturing an intentionally blank teacher page.
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
 await expect(page.locator('#v5-team-project-list')).not.toContainText('RAP12 Alpha Manager Only');
 await captureTeamEvidence(page,testInfo,'managerB',width,'projects','#v5-team-card');
 await checkMobileNavClearance(page,testInfo,'managerB',width,'projects','#v5-team-card');
 await teamSection(page,'learning');
 await expect(page.locator('#v5-learning-team-select option[value="'+f.ids.teamB+'"]'))
  .toHaveCount(1);
 await page.locator('#v5-learning-team-select').selectOption(f.ids.teamB);
 await expect(page.locator('#v5-learning-lessons')).toContainText('RAP12 Foreign English');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Shared Math');
 await expect(page.locator('#v5-learning-lessons')).not.toContainText('RAP12 Private Science');
 await expect(page.locator('#v5-learning-team-select option[value="'+f.ids.teamA+'"]')).toHaveCount(0);
 await captureTeamEvidence(page,testInfo,'managerB',width,'learning','#v5-learning-card');
 await checkMobileNavClearance(page,testInfo,'managerB',width,'learning','#v5-learning-card');
 await logout(page);
}
// 320/375/430 cover smaller and larger mobile devices in addition to the
// existing 390px baseline and 1440px desktop regression.
for(const width of [320,375,390,430,1440]){
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
