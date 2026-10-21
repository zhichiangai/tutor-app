// V3.5.1: required SQL privileges + existing row policies for account settings.
// A column GRANT does NOT replace RLS; both must be present.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const grant=read("../supabase/migrations/20261021190000_v351_authenticated_settings_write_grants.sql");
const app=read("../v2/app.js");
const html=read("../v2/index.html");
const rls=read("../supabase/migrations/20261021181000_v35_roles_lesson_learning.sql");

test("signed-in users receive only profile setting column UPDATE privileges",()=>{
 assert.match(grant,/grant update\s*\(\s*display_name\s*,\s*last_role\s*,\s*enabled_roles\s*,\s*roles_configured\s*\)\s*on table public\.profiles to authenticated/i);
 assert.doesNotMatch(grant,/grant\s+update\s+on\s+(table\s+)?public\.profiles/i);
 assert.doesNotMatch(grant,/\bgrant\b[^;]*\bto anon\b/i);
});
test("workspaces and pending guardian invitations have their minimum required UPDATE columns",()=>{
 assert.match(grant,/grant update\s*\(\s*name\s*\)\s*on table public\.workspaces to authenticated/i);
 assert.match(grant,/grant update\s*\(\s*email\s*\)\s*on table public\.guardian_invites to authenticated/i);
 for(const field of ["owner_id","teacher_id","student_id","payment_group_id","hourly_rate","total_amount"]){
   assert.ok(!grant.includes("update ("+field+")"),"unexpected update grant for "+field);
 }
});
test("settings, mode selection and invite-edit flows use their exact granted columns",()=>{
 assert.ok(app.includes('update({enabled_roles:selected,roles_configured:true})'));
 assert.ok(app.includes('update({last_role:role})'));
 assert.ok(app.includes('update({display_name:name})'));
 assert.ok(app.includes('from("workspaces").update({name})'));
 assert.ok(app.includes('from("guardian_invites").update({email})'));
 assert.ok(html.includes('id="mode-settings-form"'));
});
test("UI mode checkbox selection does not confer classroom authorization",()=>{
 assert.ok(app.includes("function normalizedRoles(list)"));
 assert.ok(app.includes("!enabledRoles().includes(role)"));
 assert.ok(rls.includes("profiles_enabled_roles_valid"));
 const a=app.indexOf("const VALID_ROLES=");
 const b=app.indexOf("function renderRoleSettings(){",a);
 const normalize=new Function(app.slice(a,b)+"\nreturn normalizedRoles;")();
 assert.deepEqual(normalize(["parent","teacher","parent","bogus"]),["teacher","parent"]);
 assert.deepEqual(normalize([]),[]);
});
test("parent learning subtitle and version are current",()=>{
 assert.ok(html.includes("專注度、學生心情與課後回饋"));
 assert.ok(html.includes("V3.5.1 · Made with care."));
});
