// V3.4 regression: no financial data changes; DB fixtures are exercised separately.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("../v2/app.js");
const sql=read("../supabase/migrations/20261021170000_v34_shared_integrity.sql");
const html=read("../v2/index.html");

test("V3.4 requires expected_updated_at for every existing lesson/rule/occurrence mutation",()=>{
 assert.ok(sql.includes("v_l.updated_at is distinct from"));
 assert.ok(sql.includes("v_r.updated_at is distinct from"));
 assert.ok(sql.includes("固定課表單堂版本已變更或缺少版本資料"));
 assert.ok((sql.match(/nullif\(p_payload->>'expected_updated_at',''\) is null/g)||[]).length>=4);
 assert.ok(app.includes("if(d.targetId&&!d.expectedUpdatedAt)"));
 assert.ok(app.includes("if(!version){toast("));
 assert.ok(app.includes("? sharedCourseRules().find(r=>r.id===lesson?.schedule_id)?.updated_at"));
 assert.ok(app.includes("{original_date:originalOccurrenceDate(lesson),expected_updated_at:version}"));
});

test("V3.4 locks teacher mutations, recurring writes and teacher direct table writes",()=>{
 for(const fn of ["tutor_private.v34_has_conflict","tutor_private.v34_assert_schedule_available",
  "tutor_private.v34_guard_lesson_write","tutor_private.v34_guard_rule_write",
  "tutor_private.v34_guard_exception_write","pg_advisory_xact_lock"]){
  assert.ok(sql.includes(fn),fn);
 }
 for(const trigger of ["trg_v34_guard_lesson_write","trg_v34_guard_rule_write",
  "trg_v34_guard_exception_write","trg_v34_lesson_revision","trg_v34_schedule_revision"]){
  assert.ok(sql.includes(trigger),trigger);
 }
 assert.ok(sql.includes("l.owner_id=p_teacher or l.student_id=p_student"));
 assert.ok(sql.includes("e.moved_to=p_date"));
 assert.ok(sql.includes("interval '13 days'"));
});

test("V3.4 rejects off-week biweekly exceptions and conflicts on a shifted target date",()=>{
 assert.ok(sql.includes("tutor_private.v34_occurs("));
 assert.ok(sql.includes("date_trunc('week',p_day::timestamp)"));
 assert.ok(sql.includes("extract(isodow from p_day)"));
 assert.ok(sql.includes("這天不是有效的固定上課日（請檢查雙週間隔）"));
 assert.ok(sql.includes("補課時間衝突"));
 assert.ok(sql.includes("new.original_date"));
});

test("V3.4 maintains cancellation initiator separate from source and reason",()=>{
 assert.ok(sql.includes("actor_role text"));
 assert.ok(sql.includes("cancellation_source text"));
 assert.ok(sql.includes("cancellation_reason text"));
 assert.ok(sql.includes("v_actor_role:=case when"));
 assert.ok(sql.includes("v_cancel_source:="));
 assert.ok(sql.includes("v_cancel_source='teacher' and v_actor_role<>'teacher'"));
 assert.ok(sql.includes("leave_source=v_cancel_source"));
 assert.ok(sql.includes("leave_source=null"));
 assert.ok(sql.includes("actor_id,actor_role,action,target_id,summary"));
 assert.ok(sql.includes("cancellation_reason',v.cancellation_reason"));
 assert.ok(app.includes("h.actor_role"));
});

test("V3.4 preserves old completed work and prevents retroactive series cancellations",()=>{
 assert.ok(sql.includes("v_r.starts_on,current_date"));
 assert.ok(sql.includes("public.payment_batch_items"));
 assert.ok(sql.includes("l.status<>'未付款'"));
 assert.ok(sql.includes("trg_guard_paid_lesson")===false,"must not disable existing paid guard");
 assert.ok(app.includes("停止剩餘課程"));
 assert.ok(app.includes("過去及已完成課程不會受到影響"));
});

test("V3.4 makes pricing behavior explicit without leaking dollar rates in student planner",()=>{
 assert.ok(app.includes("科目更動不會自動換算鐘點費"));
 assert.ok(app.includes("特殊科目請老師確認"));
 assert.ok(!html.includes("shared-course-hourly-rate"));
});

test("V3.4 consolidates duplicate student_links read policy without adding permissive access",()=>{
 assert.ok(sql.includes("drop policy if exists student_links_self_or_teacher_read"));
 assert.ok(!sql.includes("create policy student_links_guest"));
});

test("V3.4 documents real Google-account checks independently of CI",()=>{
 const doc=read("../docs/v34-shared-schedule-validation.md");
 for(const term of ["三個不同 Google", "撞期", "樂觀鎖", "取消來源", "雙週", "ROLLBACK"]){
  assert.ok(doc.includes(term),term);
 }
});
