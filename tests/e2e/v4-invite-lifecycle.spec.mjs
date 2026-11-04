// Real local GoTrue/JWT and PostgREST; NEVER hosted credentials or user records.
import {test} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
if(process.env.V4_E2E_LOCAL!=='1')throw Error('Isolated E2E only');
const file=process.env.V4_E2E_FIXTURE_FILE;
if(!file?.startsWith('/'))throw Error('Temporary local fixture required');
const f=JSON.parse(readFileSync(file,'utf8'));
assert.equal(f.apiUrl,'http://127.0.0.1:54321');
assert.equal(f.baseUrl,'http://127.0.0.1:3000');
const url=f.apiUrl;
async function signIn(role){
 const a=f.actors[role];
 const r=await fetch(url+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:f.anonKey,'content-type':'application/json'},
  body:JSON.stringify({email:a.email,password:a.password})
 });
 assert.equal(r.status,200,'Isolated synthetic sign in');
 const data=await r.json();
 assert.ok(data.access_token);
 return data.access_token;
}
async function rpc(jwt,name,args={}){
 const r=await fetch(url+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:f.anonKey,Authorization:'Bearer '+jwt,'content-type':'application/json'},
  body:JSON.stringify(args)
 });
 return {status:r.status,data:await r.json().catch(()=>null)};
}
async function list(jwt,table,filter,value){
 const q=url+'/rest/v1/'+table+'?select=id&'+filter+'=eq.'+encodeURIComponent(value);
 const r=await fetch(q,{headers:{apikey:f.anonKey,Authorization:'Bearer '+jwt}});
 assert.equal(r.status,200,'Read only synthetic RLS query');
 return (await r.json()).map(x=>x.id);
}
test('local QR token lifecycle requires teacher approval and revokes parent access',async ()=>{
 const teacher=await signIn('teacher'),other=await signIn('stranger');
 const id=f.ids.qaStudent;
 const denied=await rpc(other,'v4_create_connection_link',{p_side:'teacher',p_student_id:id,p_share:true});
 assert.notEqual(denied.status,200,'Other identity cannot issue teacher link');
 const made=await rpc(teacher,'v4_create_connection_link',{p_side:'teacher',p_student_id:id,p_share:true});
 assert.equal(made.status,200);
 const token=made.data;
 assert.ok(typeof token==='string'&&/^[a-f0-9]{64}$/.test(token));
 const claim=await rpc(other,'v4_claim_connection_link',{p_token:token,p_child_label:'Synthetic child'});
 assert.equal(claim.status,200);
 assert.equal(claim.data.status,'pending_teacher');
 assert.notEqual((await rpc(other,'v4_claim_connection_link',{p_token:token,p_child_label:'Replay'})).status,200,
  'One-time token cannot be reused');
 const inbox=await rpc(teacher,'v4_connection_inbox');
 assert.equal(inbox.status,200);
 assert.equal(inbox.data.find(x=>x.id===claim.data.id)?.status,'pending_teacher');
 const args={p_request_id:claim.data.id,p_approve:true,p_student_id:id};
 assert.notEqual((await rpc(other,'v4_decide_connection_request',args)).status,200,
  'Requester cannot self-approve teacher-side request');
 const approved=await rpc(teacher,'v4_decide_connection_request',args);
 assert.equal(approved.status,200);
 assert.equal(approved.data,'approved');
 const links=await list(other,'student_guardians','student_id',id);
 assert.equal(links.length,1);
 assert.deepEqual(await list(other,'lesson_records','id',f.ids.qaLesson),[f.ids.qaLesson]);
 assert.ok([200,204].includes((await rpc(other,'v4_disconnect_guardian',{p_student_guardian_id:links[0]})).status));
 assert.deepEqual(await list(other,'student_guardians','student_id',id),[]);
 assert.deepEqual(await list(other,'lesson_records','id',f.ids.qaLesson),[]);
 assert.deepEqual(await list(teacher,'lesson_records','id',f.ids.qaLesson),[f.ids.qaLesson]);
});
