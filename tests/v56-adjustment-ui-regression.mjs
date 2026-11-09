import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const ui=readFileSync(new URL('v2/v56-adjustments.js',root),'utf8');
const billing=readFileSync(new URL('v2/v5-billing.js',root),'utf8');
const html=readFileSync(new URL('v2/index.html',root),'utf8');

test('V5.6 browser module and connected Team billing module parse cleanly',()=>{
 for(const name of ['v2/v56-adjustments.js','v2/v5-billing.js'])
  execFileSync(process.execPath,['--check',new URL(name,root).pathname],{
   timeout:10000,stdio:'pipe'
  });
});

test('V5.6 Team billing UI is manager-only and requires guarded RPC data',()=>{
 assert.match(billing,/createV56AdjustmentsUI\(\{getClient,notify,refresh\}\)/);
 assert.match(billing,/v56_team_adjustment_overview/);
 assert.match(billing,/adjustmentsOverview=adj\.error\?null:adj\.data/);
 assert.match(billing,/renderAdjustments\(false\)/);
 assert.match(billing,/renderAdjustments\(true\)/);
 assert.match(ui,/state\?\.allowed&&state\.teamId/);
 assert.match(ui,/state\.adjustments\?\.team_id===state\.teamId/);
 assert.match(ui,/state\.paymentOverview\.team_id===state\.teamId/);
 assert.match(ui,/state\.adjustments\?\.month===state\.month/);
 assert.match(ui,/panel\.classList\.toggle\('hidden',!state\?\.allowed\)/);
 assert.match(ui,/!validShape/);
 assert.match(ui,/!state\?\.allowed\|\|busy/);
 assert.doesNotMatch(ui,/getClient\(\)\.from\('(?:v5_team_payment|v56_team_credit)/);
});

test('V5.6 UI supports all six manager-side append-only adjustment actions',()=>{
 for(const token of [
  'v56_void_team_pending_payment',
  'v56_correct_team_payment_metadata',
  'v56_request_team_credit_refund',
  'v56_decide_team_credit_refund',
  'v56_record_team_refund_manual_paid',
  'v56_team_adjustment_overview',
  'refund-request','correct-note','correct-method','manual-paid',
  "window.confirm","window.prompt","crypto.randomUUID()",
  "bank_verified"
 ]){
  assert.ok((ui+billing+html).includes(token),'Missing V5.6 UI element '+token);
 }
 assert.match(ui,/await refresh\(\)/);
 assert.match(ui,/if\(signature\)keys\.delete\(signature\)/);
 assert.match(ui,/重試相同輸入會沿用操作碼/);
 assert.match(ui,/actual|銀行未驗證|銀行系統驗證/);
});

test('V5.6 adjustment controls are isolated to Team billing and preserve historical rows',()=>{
 for(const id of ['v56-adjustments-panel','v56-adjustments-message',
  'v56-adjustments-payments','v56-adjustments-credits','v56-adjustments-history'])
  assert.ok(html.includes('id="'+id+'"'),'V5.6 management UI missing '+id);
 assert.match(html,/v5-team-panel hidden" id="v56-adjustments-panel"/);
 assert.match(html,/退款目前只處理尚未抵扣的預收款/);
 assert.doesNotMatch(ui,/\b(?:update|delete|upsert)\s*\(\s*['"](?:lesson_records|payment_batches)/i);
 assert.doesNotMatch(ui,/service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});
