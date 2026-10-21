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
