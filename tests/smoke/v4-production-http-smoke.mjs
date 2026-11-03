// Public, read-only Production HTTP smoke. No cookies, real account tokens,
// service_role credentials, payments, inserts, updates or deletions.
import test from 'node:test';
import assert from 'node:assert/strict';

const base='https://tutor.rapid4grad.com';
const expectedRef='vctisuglfoxyuwlvyjee';
async function get(path,opts={}){
 return fetch(new URL(path,base),{redirect:'follow',signal:AbortSignal.timeout(20000),...opts});
}
let configPromise;
async function config(){
 if(!configPromise)configPromise=(async()=>{
  const res=await get('/api/v4-config',{headers:{Accept:'application/json'}});
  assert.equal(res.status,200,'V4 production backend config HTTP status');
  const value=await res.json();
  assert.equal(value.environment,'production');
  assert.equal(value.isolated,false);
  assert.equal(value.projectRef,expectedRef);
  assert.equal(value.url,'https://'+expectedRef+'.supabase.co');
  assert.ok(/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publishableKey),
   'V4 production must return a publishable key, not a secret key');
  // Never print, store or attach the public key to logs or failure output.
  return value;
 })();
 return configPromise;
}
test('production homepage renders 好好上課 V4, not retired V1',async()=>{
 const res=await get('/');
 assert.equal(res.status,200);
 const html=await res.text();
 assert.match(html,/<title>好好上課/);
 // The physical root index is a deliberate client-side forwarder to /v2/.
 // Test the forwarder and the actual V4 page separately; fetch() cannot run JS.
 assert.match(html,/window\.location\.replace\(target\.href\)/);
 assert.match(html,/new URL\('v2\/index\.html', window\.location\.href\)/);
 const maintained=await get('/v2/index.html');
 assert.equal(maintained.status,200);
 const v4=await maintained.text();
 assert.match(v4,/<title>好好上課/);
 assert.match(v4,/V4\.0\.0/);
 assert.doesNotMatch(html,/<title>家教時數帳本/);
});
test('retired frontend/index.html does not serve old V1',async()=>{
 const res=await get('/frontend/index.html');
 assert.equal(res.status,200);
 assert.ok(!new URL(res.url).pathname.startsWith('/frontend/'),
  'V1 legacy URL must redirect away from retired frontend');
 const html=await res.text();
 assert.match(html,/<title>好好上課/);
});
test('V4 frontend modules are served',async()=>{
 for(const p of ['/v2/app.js','/v2/v4-connections.js','/v2/v4-contacts.js']){
  const res=await get(p);assert.equal(res.status,200,'Module '+p+' returned '+res.status);
  const body=await res.text();
  assert.ok(body.length>500,'Module '+p+' appears empty');
 }
});
test('Vercel production backend points only to approved Supabase',async()=>{
 await config();
});
test('Google OAuth provider is enabled on the active Supabase Auth endpoint',async()=>{
 const cfg=await config();
 const res=await fetch(cfg.url+'/auth/v1/settings',{headers:{apikey:cfg.publishableKey},signal:AbortSignal.timeout(20000)});
 assert.equal(res.status,200,'Public GoTrue provider settings endpoint');
 const settings=await res.json();
 assert.equal(settings.external?.google,true,'Google OAuth provider must be enabled');
});
test('anonymous caller cannot read V4 private QA accounting snapshot',async()=>{
 const cfg=await config();
 const res=await fetch(cfg.url+'/rest/v1/rpc/v4_accounting_qa_snapshot',{
  method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},
  body:'{}',signal:AbortSignal.timeout(20000)
 });
 assert.ok([401,403].includes(res.status),
 'Anonymous caller must be denied V4 QA snapshot, got HTTP '+res.status);
});
