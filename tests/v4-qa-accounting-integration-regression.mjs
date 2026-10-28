import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=(f)=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const app=load('v2/app.js');
const rpc=load('supabase/candidates/20261029_v4_accounting_qa_snapshot_rpc.sql');
const preview=load('v2/qa-ledger-synthetic.html');

test('all financial lesson calculations receive database-validated QA tags',()=>{
 assert.match(app,/function lessonBalance\(l\)\{return lessonAllocation\(l,[^\n]*officialQaTags\(\)\)\}/);
 assert.match(app,/qaTags:officialQaTags\(\)/);
 assert.match(app,/const billed=official\.reduce/);
 assert.match(app,/const confirmed=official\.reduce/);
 assert.match(app,/renderStudentBilling\(official\)/);
 assert.match(app,/unconfirmedBatches=state\.paymentBatches\.filter\([^\n]*!isQaBatch\(b\)/);
});

test('missing or unauthorized QA classification must stop live data initialization',()=>{
 assert.match(app,/client\.rpc\("v4_accounting_qa_snapshot"\)/);
 assert.match(app,/if\(qaError\)throw Error\("帳務 QA 分類資料無法驗證/);
 assert.match(app,/帳務 QA 分類資料格式不完整/);
 assert.match(app,/state\.qaClassificationReady=true;/);
 assert.match(app,/state\.qaClassificationReady=false;/);
 assert.match(app,/state\.qaTags=\{qaBatchIds:\[\],qaLessonIds:\[\],qaLegacyReceiptLessonIds:\[\]\}/);
});

test('simulated payment history is unambiguously labeled and cannot be confirmed',()=>{
 assert.match(app,/QA 模擬付款 · 非實際銀行入帳/);
 assert.match(app,/QA 測試紀錄 · 不列入正式入帳／應收統計/);
 assert.match(app,/state\.role==="teacher"&&!qa&&batch\.status==="pending"/);
 assert.match(app,/state\.role==="teacher"&&!qa&&batch\.status==="confirmed"/);
 assert.match(app,/家長回報付款日期/);
 assert.doesNotMatch(app,/家長實際付款：/);
});

test('snapshot checks active guardian teacher-student-workspace link and never returns reasons',()=>{
 assert.match(rpc,/security definer set search_path=''/);
 for(const field of ['g.guardian_id','g.teacher_id','g.student_id','g.workspace_id'])
  assert.ok(rpc.includes(field),'Missing identity verification '+field);
 assert.match(rpc,/revoke all on function public\.v4_accounting_qa_snapshot\(\) from public, anon/);
 assert.match(rpc,/grant execute on function public\.v4_accounting_qa_snapshot\(\) to authenticated/);
 const out=rpc.match(/jsonb_build_object\([\s\S]*?\);\s*\$function\$/);
 assert.ok(out,'snapshot output exists');
 assert.doesNotMatch(out[0],/reason|amount|note|student_name|email/i);
});

test('synthetic preview cannot connect to a real database or post form data',()=>{
 assert.match(preview,/connect-src 'none'/);
 assert.match(preview,/form-action 'none'/);
 assert.match(preview,/robots" content="noindex,nofollow"/);
 assert.match(preview,/非正式帳務資料/);
 assert.match(preview,/import \{lessonAllocation\} from '\.\/payment-ledger\.js'/);
 for(const item of ['qa-part-400','real-part-600','qa-full-300','qa-full-700',
                    'legacy-oct','cross-month-800','顯示 QA 測試明細']){
  assert.ok(preview.includes(item),'Missing synthetic case '+item);
 }
 assert.doesNotMatch(preview,/https?:\/\/[^'"]*(supabase\.co|tutor\.rapid4grad\.com)/);
});
