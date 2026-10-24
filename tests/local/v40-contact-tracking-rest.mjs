// Opt-in synthetic localhost Auth + REST integration.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.V40_LOCAL_CONTACT_TRACKING_TEST,'1');
const root=fileURLToPath(new URL('../../',import.meta.url));
const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{cwd:root,encoding:'utf8'}));
assert.equal(status.API_URL,'http://127.0.0.1:54321');
const sql=s=>execFileSync('docker',['exec','supabase_db_tutor_v4_isolated','psql','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At','-c',s],{encoding:'utf8'}).trim();
let checks=0;const eq=(x,y)=>{assert.deepEqual(x,y);checks++};
const users={};
for(const label of ['teacher','parent','other']){
 const email=`track-${label}-${randomUUID()}@local.invalid`;
 const r=await fetch(status.API_URL+'/auth/v1/signup',{method:'POST',headers:{apikey:status.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({email,password:randomBytes(24).toString('base64url')+'aA1'})});
 const j=await r.json();eq(r.status,200);users[label]={id:j.user.id,email,jwt:j.access_token};
}
async function rpc(who,name,args={}){
 const r=await fetch(status.API_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+(who?users[who].jwt:status.ANON_KEY),'Content-Type':'application/json'},body:JSON.stringify(args)});
 const t=await r.text();return {status:r.status,data:t?JSON.parse(t):null};
}
async function inbox(who){const r=await rpc(who,'v4_contact_inbox');eq(r.status,200);return r.data;}
const unknown=`unknown-${randomUUID()}@local.invalid`;
const registered=await rpc('teacher','v4_contact_request',{p_email:users.parent.email,p_my_role:'teacher'});
const unregistered=await rpc('teacher','v4_contact_request',{p_email:unknown,p_my_role:'teacher'});
eq(registered.data,unregistered.data);eq(registered.status,200);eq(unregistered.status,200);
let sent=(await inbox('teacher')).filter(x=>x.kind==='outgoing');
eq(sent.length,2);eq(sent.map(x=>x.status),['pending','pending']);
const missing=sent.find(x=>x.other_name===unknown);
const found=sent.find(x=>x.other_name===users.parent.email);
assert.ok(missing.expires_at&&found.expires_at);checks++;
eq((await inbox('parent')).filter(x=>x.kind==='contact').length,1);
let action=await rpc('other','v4_contact_action',{p_id:found.id,p_action:'cancel'});assert.notEqual(action.status,200);checks++;
action=await rpc('teacher','v4_contact_action',{p_id:missing.id,p_action:'cancel'});eq(action.data,'cancelled');
eq((await inbox('teacher')).find(x=>x.id===missing.id).status,'cancelled');
const repeated=await rpc('teacher','v4_contact_request',{p_email:users.parent.email,p_my_role:'teacher'});eq(repeated.status,200);
eq((await inbox('teacher')).filter(x=>x.kind==='outgoing'&&x.status==='pending').length,1);
const contact=(await inbox('parent')).find(x=>x.kind==='contact');
action=await rpc('teacher','v4_contact_action',{p_id:contact.id,p_action:'approve'});assert.notEqual(action.status,200);checks++;
action=await rpc('parent','v4_contact_action',{p_id:contact.id,p_action:'approve'});eq(action.data,'connected');
eq((await inbox('teacher')).filter(x=>x.kind==='outgoing'&&x.status==='pending').length,0);
eq((await inbox('teacher')).filter(x=>x.kind==='contact'&&x.status==='connected').length,1);
const expired=await rpc('teacher','v4_contact_request',{p_email:unknown,p_my_role:'teacher'});eq(expired.status,200);
const expiredId=(await inbox('teacher')).find(x=>x.kind==='outgoing'&&x.status==='pending').id;
sql(`update public.v4_contact_outgoing_invites set expires_at=now()-interval '1 minute' where id='${expiredId}'`);
eq((await inbox('teacher')).find(x=>x.id===expiredId).status,'expired');
eq((await rpc('teacher','v4_contact_request',{p_email:unknown,p_my_role:'teacher'})).status,200);
eq((await inbox('teacher')).filter(x=>x.kind==='outgoing'&&x.other_name===unknown&&x.status==='pending').length,1);
const table=await fetch(status.API_URL+'/rest/v1/v4_contact_outgoing_invites?select=id',{headers:{apikey:status.ANON_KEY,Authorization:'Bearer '+users.teacher.jwt}});
eq(table.status,403);
console.log(JSON.stringify({result:'PASS',authUsers:3,assertions:checks,productionWrites:0}));
