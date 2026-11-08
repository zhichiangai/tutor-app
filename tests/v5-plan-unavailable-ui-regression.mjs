// Synthetic-only UI contract: V5 schema is intentionally absent on Production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../v2/v5-plans.js',import.meta.url),'utf8');
const {createV5PlanUI}=await import('data:text/javascript;base64,'+
 Buffer.from(source).toString('base64'));

function element(){
 const e={children:[],textContent:'',className:'',classes:new Set()};
 e.classList={
  add:x=>e.classes.add(x),
  toggle:(x,on)=>on?e.classes.add(x):e.classes.delete(x)
 };
 e.replaceChildren=(...nodes)=>{e.children=[...nodes];e.textContent=''};
 e.append=(...nodes)=>e.children.push(...nodes);
 return e;
}
function allText(node){
 return [node.textContent,...node.children.flatMap(allText)].join(' | ');
}
test('missing V5 RPC shows read-only Free/Plus/Team prices without claiming current plan',async()=>{
 const panel=element(),card=element();
 const oldDocument=globalThis.document;
 globalThis.document={
  createElement:()=>element(),
  getElementById:id=>id==='v5-plan-content'?panel:id==='v5-plan-card'?card:null
 };
 try{
  const ui=createV5PlanUI({
   getClient:()=>({rpc:async(name)=>{
    assert.equal(name,'v5_my_plan');
    return {data:null,error:{message:'Could not find the function public.v5_my_plan'}};
   }}),
   getUser:()=>({id:'synthetic-teacher'}),
   getRole:()=> 'teacher',
   isReady:()=>true
  });
  await ui.refresh();
  const text=allText(panel);
  for(const phrase of ['方案後端尚未啟用','目前使用方案及名額尚無法確認',
   'Free','Plus','Team','NT$99／月','NT$399／月','暫不提供線上購買']){
   assert.ok(text.includes(phrase),'Missing read-only plan label: '+phrase);
  }
  assert.ok(!text.includes('目前方案：'),'Unavailable backend must not imply an entitlement');
  assert.ok(!text.includes(' · 目前使用'),'Unavailable backend must not mark a paid plan active');
  assert.equal(card.classes.has('hidden'),false,'Teacher should see read-only plans');
  ui.clear();
  assert.equal(panel.children.length,0,'Logout clears displayed plan details');
  assert.equal(card.classes.has('hidden'),true);
 }finally{
  globalThis.document=oldDocument;
 }
});
