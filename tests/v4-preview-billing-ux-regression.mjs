import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const app=read('v2/app.js');
const config=read('v2/v4-config.js');
const html=read('v2/index.html');
const css=read('v2/style.css');

test('payment currency preserves cents without adding .00 to whole amounts', () => {
 const expr=app.match(/^const money = (.+);$/m);
 assert.ok(expr,'money formatter exists');
 const money=vm.runInNewContext(expr[1]);
 assert.equal(money(500),'NT$ 500');
 assert.equal(money('500.50'),'NT$ 500.50');
 assert.equal(money('0.01'),'NT$ 0.01');
});

test('history follows selected lesson month while preserving overlapping batches', () => {
 const source=app.match(/function renderPaymentHistory\(\)\{[\s\S]*?\n\}/);
 assert.ok(source,'history renderer exists');
 const dom={'#payment-history-scope':{textContent:''},'#payment-batch-history':{innerHTML:''}};
 const batches=[
  {id:'jan',period_start:'2026-01-01',period_end:'2026-01-31'},
  {id:'cross',period_start:'2026-01-28',period_end:'2026-02-03'},
  {id:'feb',period_start:'2026-02-09',period_end:'2026-02-09'}
 ];
 const ctx={
  state:{month:new Date(2026,1,1)},Date,
  dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')},
  visiblePaymentBatches:()=>batches,
  paymentHistoryHTML:rows=>rows.map(r=>r.id).join(','),
  $:selector=>dom[selector]
 };
 vm.runInNewContext(source[0]+'\nrenderPaymentHistory();',ctx);
 assert.equal(dom['#payment-batch-history'].innerHTML,'cross,feb');
 assert.match(dom['#payment-history-scope'].textContent,/2026-02-01 至 2026-02-28/);
});

test('Preview config fails closed with helpful wording on 503 or network failure', async () => {
 async function run(fetch){
  const window={location:{hostname:'preview-example.vercel.app',protocol:'https:'},fetch};
  vm.runInNewContext(config,{window});
  assert.equal(await window.V4_CONFIG_READY,null);
  return window.V4_CONFIG_ERROR;
 }
 for(const fetch of [async()=>({ok:false,status:503}),async()=>{throw Error('Failed to fetch')}]) {
  const error=await run(fetch);
  assert.match(error,/Preview 尚未設定隔離測試資料庫/);
  assert.doesNotMatch(error,/Failed to fetch/);
 }
});

test('Preview denial can be dismissed read-only, regular unauthenticated login still guards Escape', () => {
 assert.match(html,/id="login-preview-dismiss"/);
 assert.match(html,/id="preview-readonly-banner"/);
 assert.match(css,/preview-readonly \.app-shell\{pointer-events:auto/);
 assert.match(app,/if\(previewBackendUnavailable\(\)\)\{enterPreviewReadOnly\(\)/);
 assert.match(app,/if\(!activeUser\)ev\.preventDefault\(\)/);
 assert.match(app,/\$\("#login-retry"\)\.hidden=!failed\|\|previewUnavailable/);
});

test('teacher period modal excludes tagged QA when hidden and ignores stale month preferences', () => {
 assert.match(app,/state\.role==="teacher"&&!state\.showQaAccounting\?all\.filter\(s=>s\.is_qa!==true\):all/);
 assert.match(app,/validSavedDates=last\.start\?\.slice\(0,7\)===currentMonth/);
 assert.match(app,/validSavedDates\?last\.start/);
 assert.match(app,/validSavedDates\?last\.end/);
 assert.match(html,/id="payment-history-scope"/);
});

test('Preview allows navigation and month buttons but disables native write controls', () => {
 const source=app.match(/const PREVIEW_SAFE_BUTTONS=[^\n]+\nfunction isPreviewSafeControl\([\s\S]*?\n\}\nfunction applyPreviewReadOnlyControls\([\s\S]*?\n\}/);
 assert.ok(source,'readonly controls implementation exists');
 const controls=[
  {id:'nav',tagName:'BUTTON',safe:true},
  {id:'month',tagName:'BUTTON',safe:true},
  {id:'create',tagName:'BUTTON',safe:false},
  {id:'pay',tagName:'BUTTON',safe:false},
  {id:'amount',tagName:'INPUT',safe:false}
 ].map(p=>({...p,disabled:null,title:'',attributes:{},
   matches(){return this.safe},
   setAttribute(k,v){this.attributes[k]=v},
   removeAttribute(k){delete this.attributes[k]}}));
 const calendarCell={tabIndex:0,attributes:{},setAttribute(k,v){this.attributes[k]=v}};
 const document={
  body:{classList:{contains:()=>true}},
  querySelectorAll(q){return q.includes('[data-day]')?[calendarCell]:controls}
 };
 vm.runInNewContext(source[0]+'\napplyPreviewReadOnlyControls();',{document});
 assert.equal(controls[0].disabled,false);
 assert.equal(controls[1].disabled,false);
 for(const control of controls.slice(2)){
  assert.equal(control.disabled,true,control.id);
  assert.equal(control.attributes['aria-disabled'],'true',control.id);
 }
 assert.equal(calendarCell.tabIndex,-1);
 assert.equal(calendarCell.attributes['aria-disabled'],'true');
});

test('Preview capture gate blocks write clicks and submissions before app handlers', () => {
 assert.match(app,/document\.addEventListener\("click",ev=>\{[\s\S]*?ev\.stopImmediatePropagation\(\);\s*\},true\);/);
 assert.match(app,/document\.addEventListener\("submit",ev=>\{[\s\S]*?ev\.preventDefault\(\);ev\.stopImmediatePropagation\(\);\s*\},true\);/);
 assert.match(app,/function setView\(view\)\{[\s\S]*?applyPreviewReadOnlyControls\(\);/);
 assert.match(app,/function moveMonth\(offset\)\{[^\n]+applyPreviewReadOnlyControls\(\)/);
 assert.doesNotMatch(css,/preview-readonly \.app-shell\{pointer-events:none/);
});

test('payment dates are clearly reported vs bank-verified and QA is visibly distinguished',()=>{
 assert.match(app,/家長回報付款日期/);
 assert.match(app,/老師登錄收款日期/);
 assert.match(app,/系統確認狀態，銀行實際入帳應由老師核對/);
 assert.match(app,/QA 測試學生 · 此紀錄不是實際入帳證明/);
 assert.doesNotMatch(app,/家長實際付款：/);
 assert.doesNotMatch(app,/老師實際收款：/);
});
