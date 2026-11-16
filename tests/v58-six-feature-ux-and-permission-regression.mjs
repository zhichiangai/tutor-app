// V5.8 synthetic UX/permission contract. No Production, OAuth, cookies or secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Free quota is explicit with remaining seats, next step and no checkout',()=>{
 const plan=src('v2/v5-plans.js');
 assert.match(plan,/Math\.max\(0,limit-used\)/);
 assert.match(plan,/剩餘 0 名/);
 assert.match(plan,/請聯絡平台管理員申請調整方案或增加名額/);
 assert.match(plan,/目前不提供線上升級或扣款/);
 assert.match(plan,/Plus／Team 正式金流尚未開放/);
});

test('lesson modal starts in read-only mode with explicit edit and existing RPC gates',()=>{
 const html=src('v2/index.html'),js=src('v2/app.js'),css=src('v2/style.css');
 for(const id of ['lesson-detail-summary','lesson-detail-actual','lesson-detail-learning','lesson-detail-edit'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/\$\("#lesson-modal"\)\.classList\.add\("lesson-detail-view"\)/);
 assert.match(js,/\$\("#lesson-modal"\)\.classList\.remove\("lesson-detail-view"\)/);
 assert.match(css,/#lesson-modal\.lesson-detail-view #lesson-teacher-actions/);
 assert.match(css,/#lesson-modal\.lesson-detail-view #lesson-parent-actions/);
 assert.match(js,/client\.rpc\("update_lesson_learning"/);
 assert.match(js,/function saveLessonOutcome\(ev\)/);
});

test('student details, student login and guardian links have distinct deliberate disclosures',()=>{
 const html=src('v2/index.html');
 assert.match(html,/student-management-disclosure[^>]*open/);
 for(const name of ['學生基本資料','學生帳號與邀請','家長帳號與邀請'])
  assert.ok(html.includes('<summary>'+name));
 assert.match(html,/id="managed-guardian-invite-form"/);
 assert.match(html,/id="student-management-basics-form"/);
 assert.match(html,/id="managed-student-invite-form"/);
 assert.match(html,/解除帳號連結會立即影響資料可見範圍/);
});

test('Team display marks management vs assigned teaching without granting another Team management',()=>{
 const js=src('v2/v5-team.js'),html=src('v2/index.html');
 assert.match(html,/id="v5-team-access-role"/);
 assert.match(js,/目前身分：Team 管理者/);
 assert.match(js,/目前身分：Team 一般老師/);
 assert.match(js,/assigned\.filter\(p=>p\.workspace_id!==ws\?\.id\)/);
 assert.match(js,/ownManagedProject&&p\.status==='active'/);
 assert.match(js,/controls\?\.classList\.toggle\('hidden',!isOwner\)/);
 assert.match(js,/current\.assignments\.some\(a=>/);
});

test('parent Team ledger lists multiple independently authorised Team/student scopes and fails closed',async()=>{
 const content=src('v2/v56-family.js');
 const mod=await import('data:text/javascript;base64,'+Buffer.from(content).toString('base64'));
 class Node{
  constructor(tag){this.tagName=tag;this.textContent='';this.children=[];
   this.dataset={};this.className='';this.open=false;this.hiddenClass=false;
   this.classList={toggle:(_name,v)=>{this.hiddenClass=!!v}};}
  append(...args){this.children.push(...args)}
  replaceChildren(...args){this.children=[...args]}
 }
 const uiIds=['v56-parent-family-panel','v56-parent-family-content','v56-parent-family-month'];
 const elements=new Map(uiIds.map(id=>[id,new Node('div')]));
 const prev=globalThis.document;
 globalThis.document={getElementById:id=>elements.get(id),createElement:tag=>new Node(tag)};
 let role='parent',mismatch=false;
 const proposals=[
  {proposal_id:'p1',team_id:'team-alpha',team_student_id:'student-a',display_name:'孩子甲',status:'accepted'},
  {proposal_id:'p2',team_id:'team-bravo',team_student_id:'student-b',display_name:'孩子乙',status:'accepted'}];
 const client={rpc:async(name,args)=>{
  if(name==='v56_my_team_family_proposals')return {data:{proposals},error:null};
  if(name==='v56_team_parent_finance_overview'){
   const a=args.p_team_id==='team-alpha',n=a?10000:25000;
   return {data:{team_id:mismatch?'wrong-team':args.p_team_id,
     student_id:args.p_team_student_id,month:args.p_month,currency:'TWD',bank_verified:false,
     receivables:[{subject:a?'數學':'英文',fee_cents:n,outstanding_cents:n}],
     payments:[],correction_refund_history:[]},error:null};
  }
  throw Error('Unknown synthetic RPC');
 }};
 const widget=mod.createV56FamilyUI({getClient:()=>client,getUser:()=>({id:'guardian-qa'}),
  getRole:()=>role,isReady:()=>true,notify:()=>{}});
 const flatten=n=>n.textContent+' '+n.children.map(flatten).join(' ');
 try{
  await widget.refresh();
  const children=elements.get('v56-parent-family-content').children;
  assert.equal(children.length,2);
  assert.match(flatten(children[0]),/孩子甲/);
  assert.match(flatten(children[0]),/數學/);
  assert.doesNotMatch(flatten(children[0]),/孩子乙|英文/);
  assert.match(flatten(children[1]),/孩子乙/);
  assert.match(flatten(children[1]),/英文/);
  assert.doesNotMatch(flatten(children[1]),/孩子甲|數學/);
  assert.equal(children[0].open,true);
  assert.equal(children[1].open,false);
  mismatch=true;await widget.refresh();
  assert.doesNotMatch(flatten(elements.get('v56-parent-family-content')),/數學|英文|NT\$/);
  mismatch=false;await widget.refresh();
  role='student';widget.render();
  assert.equal(elements.get('v56-parent-family-content').children.length,0);
  assert.equal(elements.get('v56-parent-family-panel').hiddenClass,true);
 }finally{widget.clear();globalThis.document=prev}
});
