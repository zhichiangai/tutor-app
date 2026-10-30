import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('v2/qa-ledger-synthetic.html');
const externalJs=read('v2/qa-ledger-synthetic.js');
const ledger=read('v2/payment-ledger.js').replace(/^export /gm,'');

function createFakeDocument(){
 const nodes=new Map();
 function get(id){
  if(!nodes.has(id)){
   const handlers=new Map();
   nodes.set(id,{
    id, textContent:'', innerHTML:'', disabled:false, checked:false,
    addEventListener(name,fn){handlers.set(name,fn)},
    dispatch(name){const handler=handlers.get(name);assert.equal(typeof handler,'function','missing '+name+' handler for '+id);handler()}
   });
  }
  return nodes.get(id);
 }
 return {getElementById:get,get};
}

test('CSP allows same-origin external module and rejects inline script regressions',()=>{
 assert.match(html,/script-src 'self'/);
 assert.match(html,/connect-src 'none'/);
 assert.match(html,/form-action 'none'/);
 assert.match(html,/<script type="module" src="\.\/qa-ledger-synthetic\.js"><\/script>/);
 assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/i);
 assert.match(externalJs,/^import \{lessonAllocation\} from '\.\/payment-ledger\.js';/);
});

test('synthetic ledger actually initializes month, totals, details, events and QA toggle',()=>{
 const doc=createFakeDocument();
 const js=externalJs.replace(/^import \{lessonAllocation\} from '\.\/payment-ledger\.js';\s*/,'');
 assert.notEqual(js,externalJs,'external module import must resolve to the local ledger');
 vm.runInNewContext(ledger+'\n'+js,{document:doc});
 const get=doc.get;
 const octoberSummary=get('summary').innerHTML;
 assert.equal(get('month-label').textContent,'2026 年 10 月');
 assert.match(octoberSummary,/NT\$ 1,700/);
 assert.match(octoberSummary,/NT\$ 600/);
 assert.match(octoberSummary,/NT\$ 1,100/);
 assert.match(get('lesson-rows').innerHTML,/模擬學生 A/);
 assert.doesNotMatch(get('lesson-rows').innerHTML,/整堂模擬課程/);
 assert.match(get('batch-rows').innerHTML,/real-part-600/);
 assert.doesNotMatch(get('batch-rows').innerHTML,/qa-part-400/);
 assert.match(get('history-scope').textContent,/2026-10-01 至 2026-10-31/);

 get('show-qa').checked=true;
 get('show-qa').dispatch('change');
 assert.equal(get('summary').innerHTML,octoberSummary,
   'Showing QA details must not inflate the official receipts');
 assert.match(get('lesson-rows').innerHTML,/整堂模擬課程/);
 assert.match(get('lesson-rows').innerHTML,/舊式模擬收款/);
 assert.match(get('batch-rows').innerHTML,/qa-part-400/);
 assert.match(get('batch-rows').innerHTML,/real-part-600/);
 assert.match(get('batch-rows').innerHTML,/cross-month-800/);

 get('previous').dispatch('click');
 assert.equal(get('month-label').textContent,'2026 年 9 月');
 assert.match(get('summary').innerHTML,/NT\$ 800/);
 assert.match(get('history-scope').textContent,/2026-09-01 至 2026-09-30/);
 assert.match(get('batch-rows').innerHTML,/cross-month-800/);
 get('next').dispatch('click');
 assert.equal(get('month-label').textContent,'2026 年 10 月');
 assert.equal(get('summary').innerHTML,octoberSummary);
 get('next').dispatch('click');
 assert.equal(get('month-label').textContent,'2026 年 11 月');
 assert.match(get('summary').innerHTML,/NT\$ 0/);
 assert.match(get('lesson-rows').innerHTML,/本月沒有課程紀錄/);
 assert.equal(get('next').disabled,true);
});
