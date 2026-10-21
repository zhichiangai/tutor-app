// V3.5 regression: formal sign-in, settings, lesson learning and billing.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");
const sql=read("../supabase/migrations/20261021181000_v35_roles_lesson_learning.sql");

test("production no longer displays interactive demo",()=>{
 assert.ok(html.includes('id="google-login"'));
 for(const id of ["demo-login","demo-reset","demo-banner","go-live"])
  assert.ok(!html.includes('id="'+id+'"'),id);
 assert.ok(app.includes('const state={mode:"live"'));
 assert.ok(css.includes(".login-required .app-shell"));
});
test("settings and new lesson journal inputs exist",()=>{
 for(const id of ["view-settings","mode-settings-form","profile-display-form",
 "workspace-account","sign-out","lesson-focus-stars","lesson-mood-stars",
 "lesson-content","lesson-feedback","lesson-learning-save"]){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.equal((html.match(/name="enabled-role"/g)||[]).length,3);
});

test("account modes are selected explicitly and verified before switching",()=>{
 assert.ok(app.includes("function normalizedRoles(list)"));
 assert.ok(app.includes('!enabledRoles().includes(role)'));
 assert.ok(app.includes("roles_configured:true"));
 assert.ok(app.includes("normalizedRoles(profile.enabled_roles)"));
 assert.ok(sql.includes("profiles_enabled_roles_valid"));
 assert.ok(sql.includes("roles_configured boolean"));
});
test("paid-safe feedback RPC writes only teaching fields",()=>{
 const start=sql.indexOf("create or replace function public.update_lesson_learning(");
 const end=sql.indexOf("revoke all on function public.update_lesson_learning",start);
 const fn=sql.slice(start,end);
 assert.ok(fn.includes("security invoker"));
 assert.ok(fn.includes("owner_id=auth.uid() and type='lesson'"));
 assert.ok(fn.includes("updated_at=p_expected_updated_at"));
 for(const k of ["lesson_content=","focus_rating=","mood_rating=","remarks="])assert.ok(fn.includes(k),k);
 for(const k of ["hourly_rate=","total_amount=","actual_hours=","status="])assert.ok(!fn.includes(k),k);
 assert.ok(sql.includes("lesson_feedback_audit"));
 assert.ok(sql.includes("trg_v35_track_lesson_feedback"));
 assert.ok(app.includes('client.rpc("update_lesson_learning"'));
});
test("student-safe portal carries content and mood but not billing",()=>{
 const i=sql.indexOf("create or replace function public.student_portal_data()");
 assert.ok(i>=0);
 const p=sql.slice(i);
 assert.ok(p.includes("'lesson_content',l.lesson_content"));
 assert.ok(p.includes("'mood_rating',l.mood_rating"));
 const lessons=p.slice(p.indexOf("'lessons'"),p.indexOf("'schedules'"));
 for(const k of ["'hourly_rate'","'total_amount'","'payment_date'"]){
  assert.ok(!lessons.includes(k),"student billing leak "+k);
 }
});

test("focus/mood star controls and learning updates are wired",()=>{
 assert.ok(app.includes("function renderLessonStars()"));
 assert.ok(app.includes("[1,2,3,4,5].map"));
 assert.ok(app.includes("state.lessonRatings[key]===score?null:score"));
 assert.ok(app.includes("focus_rating:feedback.p_focus_rating"));
 assert.ok(app.includes("mood_rating:feedback.p_mood_rating"));
});
test("parent sees a compact learning row in monthly and pre-payment lists",()=>{
 assert.ok(app.includes("function learningPaymentLine(lesson,due=null)"));
 assert.ok(app.includes('compactStars(lesson.focus_rating)'));
 assert.ok(app.includes('compactStars(lesson.mood_rating)'));
 assert.ok(app.includes('state.role==="parent"?ls.map(l=>learningPaymentLine(l))'));
 assert.ok(app.includes("learningPaymentLine(lesson,allocation.available)"));
 assert.ok(css.includes(".learning-payment-line"));
});
test("compact 5-star summary is correct and blank is not rated",()=>{
 const i=app.indexOf("function compactStars(");
 const j=app.indexOf("function learningPaymentLine(",i);
 assert.ok(i>=0&&j>i);
 const fn=new Function(app.slice(i,j)+"\nreturn compactStars")();
 assert.equal(fn(4),"★★★★☆");
 assert.equal(fn(1),"★☆☆☆☆");
 assert.equal(fn(null),"未評分");
 assert.equal(fn(0),"未評分");
});
test("single settings route with three user-selected modes",()=>{
 assert.ok(app.includes('state.view==="settings"'));
 assert.ok(app.includes('renderRoleSettings()'));
 assert.ok(app.includes('$("#mode-settings-form").addEventListener("submit",saveEnabledRoles)'));
 assert.ok(app.includes('if(!activeUser)showModal("account-modal")'));
});
