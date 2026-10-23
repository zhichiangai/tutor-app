import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {exactCents,asAmount,correctionLedger,prepareCorrection} from "../v2/payment-correction.js";

const uuid="f18a3a4d-6074-4828-bf15-2a4abf1c3604";
const batch={id:"batch1",status:"confirmed",paid_amount:"1500.00"};
const allocations=[{batch_id:"batch1",lesson_id:"l1",allocated_amount:"1000.00"},
 {batch_id:"batch1",lesson_id:"l2",allocated_amount:"500.00"}];

test("exact cents rejects fractional cents, negative and unsafe numbers",()=>{
 assert.equal(exactCents("1300.00"),130000);
 assert.equal(asAmount(130050),"1300.50");
 for(const input of ["-1","1.234","abc","1e4","90071992547409.93"]){
  assert.throws(()=>exactCents(input));
 }
});
test("two-lesson confirmed payment supports partial corrections without floating-point drift",()=>{
 const c1={id:"correction1",batch_id:"batch1"};
 const c2={id:"correction2",batch_id:"batch1"};
 const lines=[{correction_id:"correction1",batch_id:"batch1",lesson_id:"l1",amount:"250.00"},
  {correction_id:"correction2",batch_id:"batch1",lesson_id:"l2",amount:"500.00"}];
 const a=correctionLedger({id:"l1",total_amount:"1000.00"},[batch],allocations,[c1,c2],lines);
 const b=correctionLedger({id:"l2",total_amount:"1000.00"},[batch],allocations,[c1,c2],lines);
 assert.deepEqual([a.confirmed,a.corrected,a.available],[75000,25000,25000]);
 assert.deepEqual([b.confirmed,b.corrected,b.available],[0,50000,100000]);
});
test("preview uses only confirmed items and reserves pending allocations",()=>{
 const batches=[batch,{id:"pending1",status:"pending"}];
 const rows=[...allocations,{batch_id:"pending1",lesson_id:"l1",allocated_amount:"100.00"}];
 const r=correctionLedger({id:"l1",total_amount:"1200.00"},batches,rows);
 assert.deepEqual([r.original,r.confirmed,r.pending,r.available],[100000,100000,10000,10000]);
});
test("a proposed correction validates reason, idempotency key, ownership of allocations and caps",()=>{
 const base={batch,items:allocations,prior:[],reason:"家長表示尚未實際轉帳，重新核對",idempotencyKey:uuid};
 const valid=prepareCorrection({...base,requested:[{lesson_id:"l1",amount:"250.00"},{lesson_id:"l2",amount:"500.00"}]});
 assert.equal(valid.amount,"750.00");
 assert.equal(valid.lines.length,2);
 for(const requested of [
   [{lesson_id:"l1",amount:"1000.01"}],
   [{lesson_id:"l3",amount:"20.00"}],
   [{lesson_id:"l1",amount:"0"}],
   [{lesson_id:"l1",amount:"1.001"}],
   [{lesson_id:"l1",amount:"1.00"},{lesson_id:"l1",amount:"1.00"}]
 ]){
  assert.throws(()=>prepareCorrection({...base,requested}));
 }
 assert.throws(()=>prepareCorrection({...base,reason:"短",requested:[{lesson_id:"l1",amount:"1.00"}]}));
 assert.throws(()=>prepareCorrection({...base,idempotencyKey:"",requested:[{lesson_id:"l1",amount:"1.00"}]}));
});
test("per-lesson prior corrections reduce maximum remaining correction",()=>{
 const base={batch,items:allocations,prior:[{batch_id:"batch1",lesson_id:"l1",amount:"800.00"}],
  reason:"再次核對銀行流水並更正付款",idempotencyKey:uuid};
 assert.throws(()=>prepareCorrection({...base,requested:[{lesson_id:"l1",amount:"250.00"}]}));
 assert.equal(prepareCorrection({...base,requested:[{lesson_id:"l1",amount:"200.00"}]}).amount,"200.00");
});
test("teacher sees preview only in isolated V4 and no correction write button",()=>{
 const app=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8");
 assert.match(app,/batch\.status==="confirmed"&&V4_CONFIG_VALID/);
 assert.match(app,/data-action="preview-correction"/);
 assert.match(app,/async function previewConfirmedBatchCorrection/);
 assert.match(app,/client\.rpc\("v4_payment_correction_preview"/);
 assert.match(app,/authDataGeneration!==generation/);
 assert.match(app,/沖銷功能尚未啟用/);
 assert.doesNotMatch(app,/client\.rpc\("v4_apply_payment_correction"/);
});
test("new schema cannot be edited by browser roles and has no exposed mutation RPC",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261024043000_v40_payment_correction_foundation.sql",import.meta.url),"utf8");
 assert.match(sql,/create table public.payment_batch_corrections/);
 assert.match(sql,/create table public.payment_batch_correction_items/);
 assert.match(sql,/revoke all on public.payment_batch_corrections,public.payment_batch_correction_items/);
 assert.match(sql,/v4_correction_header_immutable/);
 assert.match(sql,/v4_correction_items_immutable/);
 assert.match(sql,/g\.workspace_id=b\.workspace_id/);
 assert.match(sql,/b\.teacher_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/v4_payment_correction_preview/);
 assert.match(sql,/'can_apply',false/);
 assert.doesNotMatch(sql,/function public\.v4_apply_payment_correction/);
});
