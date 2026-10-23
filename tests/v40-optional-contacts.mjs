import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const sql=read("../supabase/migrations/20261024033000_v4_account_contacts.sql");
const privacy=read("../supabase/migrations/20261024035831_v4_contact_privacy_hardening.sql");
const ui=read("../v2/v4-contacts.js");
const app=read("../v2/app.js");
const html=read("../v2/index.html");
const css=read("../v2/style.css");

test("optional contact model uses an independent table and does not grant student permissions",()=>{
 assert.match(sql,/create table public\.v4_account_contacts/);
 assert.match(sql,/alter table public\.v4_account_contacts enable row level security/);
 assert.match(sql,/revoke all on table public\.v4_account_contacts from public,anon,authenticated/);
 assert.match(sql,/constraint v4_contact_distinct_people/);
 assert.match(sql,/constraint v4_contact_requested_party/);
 assert.doesNotMatch(sql,/\b(?:insert|update|delete|alter)\s+(?:into\s+|table\s+)?public\.(?:students|student_guardians|payment_batches|payment_batch_items|lesson_records|family_requests)\b/i);
});
test("contact actions are role scoped and cannot be self-approved or force unlink of pending invite",()=>{
 for(const name of ["v4_contact_request","v4_contact_inbox","v4_contact_action"]){
  assert.match(sql,new RegExp("function public\\."+name+"\\("));
 }
 assert.match(sql,/v_link\.requested_by=v_actor/);
 assert.match(sql,/v_link\.requested_by<>v_actor/);
 assert.match(sql,/v_link\.status<>'connected'/);
 assert.match(sql,/if not found or v_actor not in/);
 assert.match(sql,/tutor_private\.v4_limit\('v4_contact_request',10\)/);
});
test("no browser table access and anon cannot invoke contact RPC",()=>{
 for(const signature of ["v4_contact_request(text,text)","v4_contact_inbox()","v4_contact_action(uuid,text)"]){
  assert.ok(sql.includes("revoke all on function public."+signature+" from public,anon"));
  assert.ok(sql.includes("grant execute on function public."+signature+" to authenticated"));
 }
});
test("contact UI is independent of child name, student selection and original course link",async()=>{
 assert.match(html,/id="v4-account-contact-card"/);
 assert.match(html,/id="v4-account-contact-content"/);
 assert.match(ui,/id="v4-account-contact-form"/);
 assert.match(ui,/v4_contact_request/);
 assert.match(ui,/v4_contact_inbox/);
 assert.match(ui,/v4_contact_action/);
 assert.match(ui,/不會自動開放任何課程、學生或帳務/);
 assert.doesNotMatch(ui,/\bservice_role\b/);
 assert.match(app,/v4ContactsUI\.clear\(\)/);
 assert.match(app,/v4ContactsUI\.refresh\(\)/);
 assert.match(css,/#v4-account-contact-content/);
 const module=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(ui));
 assert.equal(typeof module.createV4AccountContacts,"function");
 const ctl=module.createV4AccountContacts({getClient:()=>null,getUser:()=>null,getRole:()=>"parent",notify:()=>{}});
 for(const method of ["render","refresh","clear","handleClick","handleSubmit"])assert.equal(typeof ctl[method],"function");
});
test("UI provides a deliberate two-step disconnect with historical data preserved",()=>{
 assert.match(ui,/data-contact-action="ask-disconnect"/);
 assert.match(ui,/data-contact-action="confirm-disconnect"/);
 assert.match(ui,/data-contact-action="keep"/);
 assert.match(ui,/課程與帳務資料保留/);
 assert.doesNotMatch(ui,/window\.confirm/);
});
test("outgoing pending invitations cannot reveal registered email or display name",()=>{
 assert.match(privacy,/c\.status in \('connected','disconnected'\)/);
 assert.match(privacy,/c\.status='pending' and c\.requested_by<>v_actor/);
 assert.match(privacy,/revoke all on function public\.v4_contact_inbox\(\) from public,anon/);
});
