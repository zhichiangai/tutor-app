// V3.5.2 regression: paid status lock, logout DOM privacy and narrow-screen stars.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const appSource=read("../v2/app.js");
const css=read("../v2/style.css");
const migration=read("../supabase/migrations/20261022021000_v352_legacy_receipt_status_guard.sql");
const rollbackFixture=read("./sql/v352_receipt_guard_rollback.sql");

function browserHarness(){
 const nodes=new Map(), storage=new Map();
 const element=(id)=>{
  if(!nodes.has(id))nodes.set(id,{
   id,value:"",textContent:"",innerHTML:"",dataset:{},open:false,checked:false,disabled:false,
   classList:{toggle(){},add(){},remove(){},contains(){return false}},
   addEventListener(){},setAttribute(){},reset(){this.value=""},showModal(){this.open=true},close(){this.open=false}
  });
  return nodes.get(id);
 };
 const doc={
  querySelector:element,querySelectorAll:()=>[],addEventListener(){},activeElement:null,
  body:{classList:{toggle(){}}}
 };
 const window={};
 const localStorage={
  getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)
 };
 const source=appSource.replace(/^import .* from "\.\/[^"]+";/gm,"").replace(/\nmain\(\);\s*$/,"");
 const app=new Function("document","localStorage","window","crypto","setTimeout","FormData",
    source+"\nrender=()=>{};initializeLive=async()=>{};return {state,clearUserSessionState,renderStudentPortal,"+
    "signOut,ensureClient,refreshLive,getUser(){return activeUser},setUser(v){activeUser=v},"+
    "setClient(v){client=v}};")(
  doc,localStorage,window,{randomUUID:()=>"fixture"},()=>0,FormData);
 return {app,node:element,window,localStorage};
}

test("signed-out learning portal never renders stale content",()=>{
 const {app,node}=browserHarness();
 app.setUser({id:"account-a",email:"a@example.test"});
 app.state.role="student";app.state.mode="live";
 app.state.studentPortal={students:[{id:"student-a",name:"A's child"}],lessons:[],schedules:[]};
 app.state.sharedCourseHistory={"student-a":[{summary:"A's private class"}]};
 app.state.sharedCourseDraft={studentId:"student-a"};
 app.state.activeLesson="secret-lesson";
 app.state.receiptBatch="secret-receipt";
 node("#student-portal-content").innerHTML="A's private class";
 node("#shared-student-content").innerHTML="A's schedule";
 app.setUser(null);
 app.clearUserSessionState();
 app.renderStudentPortal();
 assert.equal(node("#student-portal-content").innerHTML,"");
 assert.equal(node("#shared-student-content").innerHTML,"");
 assert.equal(app.state.studentPortal.students.length,0);
 assert.deepEqual(app.state.sharedCourseHistory,{});
 assert.equal(app.state.sharedCourseDraft,null);
 assert.equal(app.state.activeLesson,null);
 assert.equal(app.state.receiptBatch,null);
 assert.equal(app.state.role,"teacher");
});

test("Google SIGNED_OUT resets learner data and DOM without a page reload",async()=>{
 const {app,node,window}=browserHarness();
 let onAuthEvent;
 window.supabase={createClient:()=>({
   auth:{onAuthStateChange(cb){onAuthEvent=cb},signOut:async()=>({error:null})}
 })};
 await app.ensureClient();
 app.setUser({id:"student-a",email:"a@example.test"});
 app.state.studentPortal={students:[{id:"a",name:"A 學生"}],lessons:[{id:"secret"}],schedules:[]};
 node("#student-portal-content").innerHTML="A 學生 付款私人課程備註";
 onAuthEvent("SIGNED_OUT",null);
 assert.equal(app.getUser(),null);
 assert.equal(node("#student-portal-content").innerHTML,"");
 assert.equal(app.state.studentPortal.lessons.length,0);
 assert.equal(node("#account-modal").open,true);
});

test("switching authenticated account A to B discards A's history, lesson and forms",async()=>{
 const {app,node,window}=browserHarness();
 let onAuthEvent;
 window.supabase={createClient:()=>({auth:{onAuthStateChange(cb){onAuthEvent=cb}}})};
 await app.ensureClient();
 app.setUser({id:"account-a"});
 app.state.role="student";app.state.view="student";
 app.state.studentPortal={students:[{id:"private-A",name:"A"}],lessons:[],schedules:[]};
 app.state.sharedCourseHistory={"private-A":[{summary:"private"}]};
 app.state.lessonRatings={focus:5,mood:2};
 app.state.activeLesson="private-A";
 node("#student-portal-content").innerHTML="Private A";
 onAuthEvent("SIGNED_IN",{user:{id:"account-b",email:"b@example.test"}});
 assert.equal(app.getUser().id,"account-b");
 assert.equal(app.state.studentPortal.students.length,0);
 assert.deepEqual(app.state.sharedCourseHistory,{});
 assert.equal(app.state.activeLesson,null);
 assert.deepEqual(app.state.lessonRatings,{focus:null,mood:null});
 assert.equal(node("#student-portal-content").innerHTML,"");
});

test("outdated asynchronous refresh from A cannot refill B's sensitive state",async()=>{
 const {app,node}=browserHarness();
 app.state.mode="live";app.setUser({id:"account-a"});
 let resolveRange;
 const pending=new Promise(resolve=>{resolveRange=resolve});
 app.setClient({
  from(){return {select(){return this},order(){return this},range:()=>pending}},
  rpc:async()=>({data:{students:[]},error:null})
 });
 const load=app.refreshLive();
 app.setUser({id:"account-b"});
 app.clearUserSessionState();
 resolveRange({data:[{id:"A-private"}],error:null});
 await load;
 assert.equal(app.state.students.length,0);
 assert.equal(app.state.lessonRecords?.length||0,0);
 assert.equal(node("#student-portal-content").innerHTML,"");
});

test("legacy status-first bypass is rejected before financial UPDATE",()=>{
 assert.ok(migration.includes("v_old_paid := old.status in ('老師已收到','家長已付款')"));
 assert.ok(migration.includes("v_financial_change and (v_old_paid or v_has_payment_request or v_has_live_batch)"));
 assert.ok(migration.includes("new.status is distinct from old.status"));
 assert.ok(migration.includes("raise exception '禁止直接解除收款狀態"));
 assert.ok(rollbackFixture.includes("update public.lesson_records set status='未付款'"));
 assert.ok(rollbackFixture.includes("update public.lesson_records set hours=3,total_amount=1500"));
 assert.ok(rollbackFixture.includes("FAILED: status-first legacy unlock succeeded"));
 assert.ok(rollbackFixture.includes("FAILED: two-step attempt changed legacy paid row"));
});

test("audited reversal is teacher-scoped, single-use and preserves financial amount",()=>{
 assert.ok(migration.includes("tutor_private.legacy_receipt_reversal_audit"));
 assert.ok(migration.includes("authorized_txid=pg_catalog.txid_current()"));
 assert.ok(migration.includes("set applied=true"));
 assert.ok(migration.includes("and x.actor_id=(select auth.uid())"));
 assert.ok(migration.includes("l.id=p_lesson_id and l.owner_id=v_actor"));
 assert.ok(migration.includes("if v_lesson.updated_at is distinct from p_expected_updated_at"));
 assert.ok(migration.includes("p_reason text"));
 assert.ok(migration.includes("revoke all on function public.reverse_legacy_lesson_receipt"));
 assert.ok(!migration.includes("grant execute on function public.reverse_legacy_lesson_receipt(uuid,timestamptz,text)\n to anon"));
 assert.ok(rollbackFixture.includes("FAILED: non-owner reversed receipt"));
 assert.ok(rollbackFixture.includes("FAILED: no applied audit of authorized reversal"));
});

test("pending/confirmed payment requests and batch allocations block legacy reversal",()=>{
 assert.ok(migration.includes("public.family_requests"));
 assert.ok(migration.includes("public.payment_batch_items"));
 assert.ok(migration.includes("public.payment_batches"));
 assert.ok(migration.includes("not v_has_payment_request and not v_has_any_batch"));
 assert.ok(rollbackFixture.includes("FAILED: pending payment request did not guard billable hours"));
 assert.ok(rollbackFixture.includes("FAILED: allocated pending batch did not guard billable hours"));
});

test("320px displays focus and mood vertically with five 44px targets in one row",()=>{
 assert.match(css,/@media\s*\(max-width:420px\)\s*\{[\s\S]*?\.lesson-rating-row\s*\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.lesson-rating-row \.star-rating\s*\{display:grid;grid-template-columns:repeat\(5,44px\)/);
 assert.match(css,/\.lesson-rating-row \.rating-star\s*\{width:44px;height:44px;min-width:44px;min-height:44px/);
 assert.ok(css.includes("touch-action:manipulation"));
});
