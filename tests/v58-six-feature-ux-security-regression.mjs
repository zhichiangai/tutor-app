// V5.8 six-item hardening. Static contracts plus a real module-level quota render.
// Production DB and Google OAuth must not be used for these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('v2/index.html'),app=read('v2/app.js');
const team=read('v2/v5-team.js'),family=read('v2/v56-family.js');
const sql=read('supabase/migrations/20261110070000_v5_6_parent_finance_verified_bridge.sql');

function element(){
 const e={textContent:'',children:[],classes:new Set(),attributes:{}};
 e.classList={add:k=>e.classes.add(k),remove:k=>e.classes.delete(k),
  toggle:(k,on)=>{if(on)e.classes.add(k);else e.classes.delete(k)},
  contains:k=>e.classes.has(k)};
 e.append=(...nodes)=>e.children.push(...nodes);
 e.replaceChildren=(...nodes)=>{e.children=[...nodes];e.textContent=''};
 e.setAttribute=(k,v)=>{e.attributes[k]=v};
 return e;
}
function textOf(n){return (n.textContent||'')+' '+(n.children||[]).map(textOf).join(' ')}
const planCode=read('v2/v5-plans.js');
const {createV5PlanUI}=await import('data:text/javascript;base64,'+
 Buffer.from(planCode).toString('base64'));

test('full Free quota renders a safe next step without presenting Plus/Team as purchasable',async()=>{
 const old=globalThis.document,root=element(),card=element();
 globalThis.document={getElementById:id=>id==='v5-plan-content'?root:id==='v5-plan-card'?card:null,
  createElement:()=>element()};
 try{
  let result={plan:'free',student_used:3,student_limit:3,teacher_used:1,teacher_limit:1};
  const ui=createV5PlanUI({getClient:()=>({rpc:async()=>({data:result,error:null})}),
   getUser:()=>({id:'synthetic-teacher'}),getRole:()=> 'teacher',isReady:()=>true});
  await ui.refresh();
  const full=textOf(root);
  assert.match(full,/學生名額已滿/);
  assert.match(full,/下一步：/);
  assert.match(full,/聯絡網站管理員申請調整方案或測試名額/);
  assert.match(full,/尚未開放線上購買/);
  assert.equal(ui.canAddStudent(),false);
  result={...result,student_used:2};
  await ui.refresh();
  assert.ok(!textOf(root).includes('下一步：'),'Available quota must not show a quota-full CTA');
  assert.equal(ui.canAddStudent(),true);
 }finally{globalThis.document=old}
});

test('lesson details open read-only for teachers and require explicit edit action',()=>{
 for(const id of ['lesson-teacher-readonly','lesson-open-editor','lesson-readonly-actual',
  'lesson-readonly-learning','lesson-readonly-remarks'])
  assert.ok(html.includes('id="'+id+'"'),id+' missing');
 assert.match(app,/function setLessonEditorMode\(editing\)/);
 assert.match(app,/if\(teacher\)setLessonEditorMode\(false\)/);
 assert.match(app,/\$\("#lesson-open-editor"\)\.addEventListener\("click",\(\)=>setLessonEditorMode\(true\)\)/);
 assert.match(app,/\$\("#lesson-teacher-actions"\)\.classList\.toggle\("hidden",!editing\)/);
 assert.match(app,/\$\("#lesson-readonly-learning"\)\.textContent=/);
});

test('student basics and relationship-changing student/guardian actions are separate',()=>{
 assert.match(html,/<details class="student-management-section student-account-disclosure" id="managed-student-disclosure">/);
 assert.match(html,/<details class="student-management-section student-account-disclosure" id="managed-guardian-disclosure">/);
 assert.match(html,/<form id="student-management-basics-form"/);
 assert.match(app,/detail\.open=false/);
 assert.match(app,/confirmSiteAction\(\{/);
});

test('Team manager and regular teacher UI labels depend on backend role scope, not a local switch',()=>{
 assert.match(html,/id="v5-team-role-scope"/);
 assert.match(team,/const isOwner=Boolean\(chosen\?\.manager_user_id===getUser\(\)\?\.id\)/);
 assert.match(team,/controls\?\.classList\.toggle\('hidden',!isOwner\)/);
 assert.match(team,/目前權限：現任 Team 管理者/);
 assert.match(team,/目前權限：Team 一般老師/);
 assert.match(team,/assigned\.length\|\|memberOfTeam/);
});

test('Team family statement still fails closed and checks every live guardian link',()=>{
 assert.match(family,/getRole\(\)==='parent'/);
 assert.match(family,/v56_my_team_family_proposals/);
 assert.match(family,/v56_team_parent_finance_overview/);
 assert.match(family,/rec\.team_id!==accepted\[i\]\.team_id/);
 assert.match(family,/rec\.student_id!==accepted\[i\]\.team_student_id/);
 assert.match(family,/bank_verified!==false/);
 assert.match(family,/Team 末碼/);
 assert.match(sql,/exists\(select 1 from public\.student_guardians sg/);
 assert.match(sql,/sg\.guardian_id=v_actor/);
 assert.match(sql,/p\.team_id=p_team_id and p\.team_student_id=p_team_student_id/);
 assert.match(sql,/revoke all on function public\.v56_team_parent_finance_overview/);
});
