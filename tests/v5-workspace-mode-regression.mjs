// V5 Workspace Mode: account-scoped UI preference must not grant Team privileges.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../v2/style.css',import.meta.url),'utf8');
const source=js.replace(/^import .* from "\.\/[^"]+";/gm,'')
 .replace(/\nmain\(\);\s*$/,'');
function harness(){
 const store=new Map();
 const storage={getItem:key=>store.get(key)||null,
  setItem:(key,value)=>store.set(key,String(value))};
 const body={classList:{toggle(){}}};
 const document={body,querySelector:()=>({
  classList:{add(){},remove(){},toggle(){}},
  setAttribute(){},style:{},dataset:{},textContent:''
 }),querySelectorAll:()=>[]};
 const harnessCode=[
  "authPhase='ready';activeUser={id:'teacher-A',email:'teacher@example.test'};",
  "render=()=>{};applyPreviewReadOnlyControls=()=>{};toast=()=>{};",
  "setView=view=>{state.view=normalizeView(view)};",
  "return {state,setWorkspaceMode,setTeamSection,normalizeView,restoreWorkspaceMode,",
  "setUser(id){activeUser={id,email:'qa@example.test'}},setRoleDirect(role){state.role=role}};"
 ].join('\n');
 const app=new Function('document','localStorage','window','crypto',
  source+'\n'+harnessCode)(document,storage,{}, {randomUUID:()=> 'qa-id'});
 return {app,store};
}
test('default teacher stays in V4; switching Team is account-scoped and routes to settings',()=>{
 const {app,store}=harness();
 assert.equal(app.state.workspaceMode,'personal');
 assert.equal(app.normalizeView('calendar'),'calendar');
 app.setWorkspaceMode('team');
 assert.equal(app.state.workspaceMode,'team');
 assert.equal(app.state.view,'settings');
 assert.equal(app.normalizeView('billing'),'settings');
 assert.equal(store.get('tutor_v5_workspace_mode_teacher-A'),'team');
 app.setTeamSection('billing');
 assert.equal(app.state.teamSection,'billing');
 app.setTeamSection('invalid');
 assert.equal(app.state.teamSection,'billing');
 app.setWorkspaceMode('personal');
 assert.equal(app.normalizeView('billing'),'billing');
 assert.equal(store.get('tutor_v5_workspace_mode_teacher-A'),'personal');
});
test('stored mode cannot bleed between Google accounts or into guardian/student roles',()=>{
 const {app,store}=harness();
 app.setWorkspaceMode('team');
 app.setUser('teacher-B');app.restoreWorkspaceMode();
 assert.equal(app.state.workspaceMode,'personal');
 app.setUser('teacher-A');app.restoreWorkspaceMode();
 assert.equal(app.state.workspaceMode,'team');
 app.setRoleDirect('parent');
 app.setWorkspaceMode('personal'); // no teacher privilege, no mutation
 assert.equal(app.state.workspaceMode,'team');
 assert.equal(app.normalizeView('billing'),'billing');
 app.setRoleDirect('student');
 assert.equal(app.normalizeView('student-calendar'),'student-calendar');
 assert.equal(app.normalizeView('billing'),'student-today');
 assert.equal(store.get('tutor_v5_workspace_mode_teacher-A'),'team');
});
test('settings-only selector, intact V4 routes and distinct Team cards',()=>{
 for(const view of ['home','calendar','billing','students','settings']){
  assert.match(html,new RegExp('data-view="'+view+'"'));
 }
 for(const panel of ['v5-team-card','v5-learning-card','v5-billing-card']){
  assert.match(html,new RegExp('id="'+panel+'"'));
 }
 for(const name of ['personal','team']){
  assert.match(html,new RegExp('data-workspace-mode="'+name+'"'));
 }
 assert.match(js,/localStorage\.setItem\(WORKSPACE_MODE_STORAGE\+"_ "\+activeUser\.id/); // replaced below
 assert.match(js,/v5TeamUI\.clear\(\);v5LearningUI\.clear\(\);v5BillingUI\.clear\(\)/);
 assert.match(css,/\.teacher-team-workspace \.side-nav \.nav-standard/);
 assert.match(css,/\.nav-team\{display:none!important\}/);
});
