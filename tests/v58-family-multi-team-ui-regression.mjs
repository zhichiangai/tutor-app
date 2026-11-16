// Synthetic, no Production: family records are grouped per authorised Team/student.
// The real PostgreSQL/JWT/RLS consent and unlink suite lives in tests/e2e/v5-team.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../v2/v56-family.js',import.meta.url),'utf8');
const {createV56FamilyUI}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

function node(){
 const o={children:[],textContent:'',className:'',dataset:{},classes:new Set()};
 o.classList={toggle:(key,on)=>{if(on)o.classes.add(key);else o.classes.delete(key)},
  add:key=>o.classes.add(key)};
 o.append=(...args)=>o.children.push(...args);
 o.replaceChildren=(...args)=>{o.children=[...args];o.textContent=''};
 return o;
}
const allText=n=>[n.textContent,...n.children.map(allText)].join(' ');
function fixture(){
 const elements=new Map();
 const old=globalThis.document;
 globalThis.document={
  getElementById:id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)},
  createElement:()=>node()
 };
 const month=new Date();
 const monthKey=String(month.getFullYear())+'-'+String(month.getMonth()+1).padStart(2,'0')+'-01';
 const teams=[
  {proposal_id:'pa',team_id:'team-AAA123',team_student_id:'student-A',display_name:'合成學生甲',status:'accepted'},
  {proposal_id:'pb',team_id:'team-BBB456',team_student_id:'student-B',display_name:'合成學生乙',status:'accepted'}
 ];
 let role='parent',mismatch=false;
 const db={
  rpc:async(name,args)=>{
   if(name==='v56_my_team_family_proposals')return {data:{proposals:teams},error:null};
   assert.equal(name,'v56_team_parent_finance_overview');
   const p=teams.find(x=>x.team_id===args.p_team_id);
   assert.ok(p,'Unknown Team must not be queried');
   const amount=p.team_id===teams[0].team_id?10000:20000;
   return {data:{team_id:mismatch&&p.team_id===teams[1].team_id?'other-team':p.team_id,
    student_id:p.team_student_id,month:monthKey,currency:'TWD',bank_verified:false,
    receivables:[{subject:'合成科目',fee_cents:amount,outstanding_cents:amount}],
    payments:[],correction_refund_history:[]},error:null};
  }
 };
 const ui=createV56FamilyUI({getClient:()=>db,getUser:()=>({id:'qa-parent'}),
  getRole:()=>role,isReady:()=>true,notify:()=>{}});
 return {ui,elements,teams,setMismatch:v=>{mismatch=v},setRole:v=>{role=v},
  cleanup:()=>{globalThis.document=old}};
}
test('multi-Team parent renders only the two separately authorised children and correct amounts',async()=>{
 const f=fixture();
 try{
  await f.ui.refresh();
  const panel=f.elements.get('v56-parent-family-panel');
  const text=allText(f.elements.get('v56-parent-family-content'));
  assert.equal(panel.classes.has('hidden'),false);
  for(const p of f.teams){
   assert.ok(text.includes(p.display_name));
   assert.ok(text.includes(p.team_id.slice(-6)));
  }
  assert.ok(text.includes('100'),'First synthetic Team summary missing');
  assert.ok(text.includes('200'),'Second synthetic Team summary missing');
  assert.ok(!text.includes('other-team'));
 }finally{f.cleanup()}
});
test('a single mismatched Team overview clears all family finance without stale rows',async()=>{
 const f=fixture();
 try{
  await f.ui.refresh();
  assert.match(allText(f.elements.get('v56-parent-family-content')),/合成學生甲/);
  f.setMismatch(true);
  await f.ui.refresh();
  const text=allText(f.elements.get('v56-parent-family-content'));
  assert.match(text,/無法驗證/);
  assert.doesNotMatch(text,/合成學生甲|合成學生乙|100|200/);
  f.setRole('student');
  f.ui.render();
  assert.equal(f.elements.get('v56-parent-family-panel').classes.has('hidden'),true);
  assert.equal(f.elements.get('v56-parent-family-content').children.length,0);
 }finally{f.cleanup()}
});
