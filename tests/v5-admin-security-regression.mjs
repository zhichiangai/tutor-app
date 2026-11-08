// V5.1 operator API security contract: no network, no credentials, no DB writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const { _test:{handle} }=require('../api/v5-admin.js');
const UID='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const WS='33333333-3333-4333-8333-333333333333';
const HOST='v5-preview.vercel.app';
const REF='abcdefghijklmnopqrst';
const ENV={
 VERCEL_ENV:'preview',VERCEL_URL:HOST,V5_ADMIN_PREVIEW_ENABLED:'true',
 V4_PREVIEW_SUPABASE_PROJECT_REF:REF,
 V4_PREVIEW_SUPABASE_URL:'https://'+REF+'.supabase.co',
 V4_PREVIEW_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',
 V5_ADMIN_SERVICE_ROLE_KEY:'synthetic_server_secret_not_production',
 V5_ADMIN_OPERATOR_UIDS:UID
};
function fakeResponse(){
 return {statusCode:0,headers:{},payload:null,
  setHeader(k,v){this.headers[k]=v},
  end(s){this.payload=JSON.parse(s);return this.payload}
 };
}
function makeFetch(uid=UID){
 const calls=[];
 async function fake(url,init){
  calls.push({url,method:init.method,headers:init.headers,body:init.body});
  let status=200,data=null;
  if(url.endsWith('/auth/v1/user'))data={id:uid,is_anonymous:false};
  else if(url.endsWith('/rest/v1/rpc/v5_admin_snapshot'))
   data=[{workspace_id:WS,plan:'free',student_used:2,qa_deleted_eligible:1}];
  else if(url.endsWith('/rest/v1/rpc/v5_admin_release_qa_seats'))data=1;
  else if(url.endsWith('/rest/v1/rpc/v5_admin_apply_plan'))status=204;
  else throw Error('Unexpected synthetic URL');
  return {ok:status>=200&&status<300,status,async json(){
   if(status===204)throw Error('No Content');
   return data;
  }};
 }
 return {fake,calls};
}
async function call({method='GET',uid=UID,body=null,env=ENV,origin='https://'+HOST,
 token='synthetic.jwt.test',contentType='application/json'}={}){
 const f=makeFetch(uid),res=fakeResponse();
 const req={method,headers:{
  host:HOST,origin,
  authorization:token?'Bearer '+token:'',
  'content-type':contentType
 },body};
 await handle(req,res,{env,fetchImpl:f.fake});
 return {status:res.statusCode,payload:res.payload,calls:f.calls,headers:res.headers};
}
test('admin is hard-disabled on Production, without touching Auth',async()=>{
 for(const env of [{...ENV,VERCEL_ENV:'production'},
  {...ENV,V5_ADMIN_PREVIEW_ENABLED:'false'},
  {...ENV,V4_PREVIEW_SUPABASE_PROJECT_REF:'vctisuglfoxyuwlvyjee'}]){
  const r=await call({env});
  assert.equal(r.status,404);
  assert.equal(r.calls.length,0);
 }
});
test('missing JWT, non-allowlisted operator and wrong origin are denied',async()=>{
 let r=await call({token:''});assert.equal(r.status,401);assert.equal(r.calls.length,0);
 r=await call({uid:OTHER});assert.equal(r.status,403);
 assert.equal(r.calls.filter(c=>c.url.includes('/rest/v1/rpc/')).length,0);
 r=await call({method:'POST',origin:'https://evil.test',body:{action:'grant'}});
 assert.equal(r.status,403);assert.equal(r.calls.length,0);
});
test('allowlisted user can read only guarded snapshot, not service secrets',async()=>{
 const r=await call();
 assert.equal(r.status,200);
 assert.equal(r.payload.workspaces[0].workspace_id,WS);
 assert.equal(r.headers['cache-control'],'no-store, max-age=0');
 assert.ok(!JSON.stringify(r.payload).includes(ENV.V5_ADMIN_SERVICE_ROLE_KEY));
 assert.equal(r.calls.filter(c=>c.url.includes('/rest/v1/rpc/')).length,1);
});
test('write requires exact action parameters and confirmation phrase',async()=>{
 const proposal={action:'grant',workspace_id:WS,plan:'pro',extra_students:0,
  reason:'Synthetic operator manual upgrade'};
 let r=await call({method:'POST',body:{...proposal,confirm:'SET PRO wrong'}});
 assert.equal(r.status,400);assert.equal(r.calls.filter(c=>c.url.includes('/rpc/')).length,0);
 r=await call({method:'POST',body:{...proposal,extra_students:-1,confirm:'SET PRO '+WS.slice(0,8)}});
 assert.equal(r.status,400);
 r=await call({method:'POST',body:{...proposal,confirm:'SET PRO '+WS.slice(0,8)}});
 assert.equal(r.status,200);assert.equal(r.payload.ok,true);
 const operation=r.calls.find(c=>c.url.includes('/rpc/v5_admin_apply_plan'));
 assert.ok(operation);
 assert.equal(JSON.parse(operation.body).p_operator_label,UID);
 assert.equal(operation.headers.authorization,'Bearer '+ENV.V5_ADMIN_SERVICE_ROLE_KEY);
 assert.ok(!JSON.stringify(r.payload).includes('synthetic_server_secret'));
});
test('QA release accepts only count-confirmed delete-only action',async()=>{
 const payload={action:'release_qa',workspace_id:WS,expected_count:1,
  reason:'QA test deletion after isolation'};
 let r=await call({method:'POST',body:{...payload,expected_count:0,confirm:'RELEASE QA 0 '+WS.slice(0,8)}});
 assert.equal(r.status,400);
 r=await call({method:'POST',body:{...payload,confirm:'RELEASE QA 9 '+WS.slice(0,8)}});
 assert.equal(r.status,400);
 r=await call({method:'POST',body:{...payload,confirm:'RELEASE QA 1 '+WS.slice(0,8)}});
 assert.equal(r.status,200);assert.equal(r.payload.released,1);
 const db=r.calls.find(c=>c.url.includes('/rpc/v5_admin_release_qa_seats'));
 assert.ok(db);
 assert.equal(JSON.parse(db.body).p_operator_user_id,UID);
 r=await call({method:'POST',body:{
  ...payload,action:'wipe_all_accounts',confirm:'RELEASE QA 1 '+WS.slice(0,8)}});
 assert.equal(r.status,400);
 assert.equal(r.calls.filter(c=>c.url.includes('/rpc/')).length,0);
});
