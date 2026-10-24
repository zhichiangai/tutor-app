import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const app=read("v2/app.js");
const html=read("v2/index.html");
const ui=read("v2/v4-connections.js");
const migration=read("supabase/migrations/20261023090000_v4_bidirectional_invites_gas.sql");
const gas=read("integrations/google-apps-script/v4-notifications/Code.gs");
const bridge=read("supabase/functions/v4-gas-bridge/index.ts");

test("V4 invitation UI is isolated to existing teacher/parent student page",()=>{
 assert.match(html,/id="v4-connection-card"/);
 assert.match(html,/id="v4-connection-content"/);
 assert.match(app,/import \{ createV4Connections \}/);
 assert.match(ui,/includes\(role\)/);
 assert.match(ui,/role==="parent"/);
 assert.match(ui,/role==="teacher"/);
 assert.doesNotMatch(html,/data-view="v4"/);
});

test("V4 requests use authenticated RPC; QR codes store only opaque token links",()=>{
 for(const fn of ["v4_request_teacher","v4_create_connection_link","v4_claim_connection_link",
   "v4_decide_connection_request","v4_cancel_connection_request","v4_connection_inbox",
   "v4_preview_connection_link","v4_disconnect_guardian"]){
   assert.ok(migration.includes("function public."+fn),fn);
 }
 assert.match(migration,/token_digest=encode\(sha256\(convert_to\(p_token/);
 assert.match(migration,/used_at is null and expires_at>now\(\)/);
 assert.match(ui,/v4invite/);
 assert.doesNotMatch(ui,/\bservice_role\b/i);
});

test("V4 request rows are not readable or writable from browser tables",()=>{
 assert.match(migration,/alter table public\.v4_connection_requests enable row level security/);
 assert.match(migration,/revoke all on public\.v4_connection_requests from public,anon,authenticated/);
 assert.match(migration,/grant execute on function public\.v4_request_teacher\(text,text\) to authenticated/);
 assert.match(migration,/revoke all on function public\.v4_mail_claim\(integer\) from public,anon,authenticated/);
 assert.match(migration,/grant execute on function public\.v4_mail_claim\(integer\) to service_role/);
});

test("V4 never grants student data through role selection or prior to approval",()=>{
 assert.match(migration,/and s\.teacher_id=r\.teacher_id/);
 assert.match(migration,/v_uid not in \(v_request.parent_id,v_request.teacher_id\)/);
 assert.match(migration,/insert into public\.student_guardians/);
 assert.doesNotMatch(ui,/window\.confirm/);
 assert.match(ui,/window\.__tutorSiteConfirm/);
 assert.match(ui,/確認解除課程連結/);
});

test("GAS notifications have protected access and no stored secret in repository",()=>{
 assert.match(bridge,/x-v4-mail-key/);
 assert.match(bridge,/V4_GAS_BRIDGE_SECRET/);
 assert.match(bridge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(gas,/PropertiesService\.getScriptProperties\(\)/);
 assert.match(gas,/GmailApp\.getAliases\(\)/);
 assert.match(gas,/MailApp\.getRemainingDailyQuota\(\)/);
 assert.match(gas,/everyMinutes\(5\)/);
 assert.doesNotMatch(gas,/sk_[a-zA-Z0-9]{20,}/);
});

test("Existing Google OAuth flow preserves shared invitation links",()=>{
 assert.match(app,/redirectTo:location\.origin\+location\.pathname\+location\.search/);
 assert.match(app,/v4ConnectionUI\.clear\(\)/);
 assert.match(app,/void v4ConnectionUI\.refresh\(\)/);
});

test("V4 browser module parses as native ES module",async()=>{
 const module=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(ui));
 assert.equal(typeof module.createV4Connections,"function");
 const controller=module.createV4Connections({
  getClient:()=>null,getUser:()=>null,getRole:()=>"parent",
  getStudents:()=>[],getLinks:()=>[],onChanged:async()=>{},notify:()=>{}
 });
 assert.equal(typeof controller.refresh,"function");
 assert.equal(typeof controller.handleClick,"function");
});
