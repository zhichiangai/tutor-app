import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const code=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8");
const draft=readFileSync(new URL("../docs/security/v359-parent-payment-rls-proposal.sql",import.meta.url),"utf8");
const start=code.indexOf("function visiblePaymentBatches(){");
const end=code.indexOf("function renderPaymentHistory(){",start);
assert.ok(start>0&&end>start,"visiblePaymentBatches must exist");
const snippet=code.slice(start,end);
function visible({role="parent",guardianLinks=[],batches=[],filter="all",id="parentA"}){
 const state={role,mode:"live",guardians:guardianLinks,paymentBatches:batches,parentTeacherFilter:filter};
 return Function("state","activeUser","asText",snippet+";return visiblePaymentBatches();")(
   state,{id},s=>String(s??""));
}
const b=(student_id,teacher_id,parent_id="parentA")=>({student_id,teacher_id,parent_id,
 created_at:"2026-10-23T00:00:00Z"});
test("parent only sees batches for currently linked student+teacher pairs",()=>{
 const batches=[b("s1","t1"),b("s2","t1"),b("s3","t2"),b("s1","t2")];
 const guardians=[{student_id:"s1",teacher_id:"t1",guardian_id:"parentA"}];
 assert.deepEqual(visible({batches,guardianLinks:guardians}),[batches[0]]);
});
test("unlink instantly removes former student's batches from client view",()=>{
 const batches=[b("s1","t1")];
 assert.equal(visible({batches,guardianLinks:[{student_id:"s1",teacher_id:"t1",guardian_id:"parentA"}]}).length,1);
 assert.equal(visible({batches,guardianLinks:[]}).length,0);
});
test("parent teacher filter is applied after live guardian linkage",()=>{
 const batches=[b("s1","t1"),b("s2","t2")];
 const links=[{student_id:"s1",teacher_id:"t1",guardian_id:"parentA"},
 {student_id:"s2",teacher_id:"t2",guardian_id:"parentA"}];
 assert.deepEqual(visible({batches,guardianLinks:links,filter:"t2"}),[batches[1]]);
});
test("teacher still sees own historical payments after guardian disconnect",()=>{
 const batches=[b("s1","t1"),b("s2","t1"),b("s3","t2")];
 assert.deepEqual(visible({role:"teacher",id:"t1",batches,guardianLinks:[]}),batches.slice(0,2));
});
test("SQL staging proposal requires exact student+teacher+workspace guardian link",()=>{
 assert.match(draft,/drop policy if exists batch_read_by_teacher_or_parent/);
 assert.match(draft,/drop policy if exists items_read_by_batch_participant/);
 assert.match(draft,/g\.teacher_id=payment_batches\.teacher_id/);
 assert.match(draft,/g\.student_id=payment_batches\.student_id/);
 assert.match(draft,/g\.workspace_id=payment_batches\.workspace_id/);
 assert.match(draft,/g\.workspace_id=b\.workspace_id/);
 assert.match(draft,/REVIEW-ONLY PROPOSAL/);
});
test("family request reads require the exact current student+teacher+workspace link",()=>{
 assert.match(draft,/drop policy if exists requests_teacher_or_parent_view/);
 assert.match(draft,/g\.teacher_id=family_requests\.teacher_id/);
 assert.match(draft,/g\.student_id=family_requests\.student_id/);
 assert.match(draft,/g\.workspace_id=family_requests\.workspace_id/);
 assert.match(draft,/teacher_id=\(select auth\.uid\(\)\)/);
});
test("application confirmation is in-app and success follows persistence",()=>{
 const from=code.indexOf("async function revokeInvite(id){");
 const fn=code.slice(from,code.indexOf("// V3: Only teacher-owned",from));
 assert.match(fn,/await confirmInApp/);
 assert.doesNotMatch(fn,/\bconfirm\(/);
 assert.ok(fn.indexOf("await persist")<fn.indexOf('toast(linked?"已解除連結。"'));
});
test("payment batch client defense includes workspace in the active-link key",()=>{
 assert.match(snippet,/g\.workspace_id\+"\\|"+g\.teacher_id\+"\\|"+g\.student_id/);
 assert.match(snippet,/b\.workspace_id\+"\\|"+b\.teacher_id\+"\\|"+b\.student_id/);
});
