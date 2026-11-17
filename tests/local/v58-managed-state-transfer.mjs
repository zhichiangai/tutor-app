// Synthetic-only Auth + Storage API migration probe for disposable local stacks.
// No production URLs, SQL rows, JWTs, service keys or real identities are logged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

if(process.env.CI!=='true'||process.env.V58_MANAGED_STATE_LOCAL!=='1'||
   process.env.SUPABASE_ACCESS_TOKEN||process.env.V58_PRIVATE_DB_URL||
   process.env.PGPASSWORD) {
  throw Error('REFUSED: only isolated synthetic CI without hosted credentials');
}
const [phase,statusPath,privateDir]=process.argv.slice(2);
assert.ok(['source','target'].includes(phase));
assert.equal(process.argv.length,5);
assert.ok(resolve(privateDir).startsWith('/tmp/')||
          resolve(privateDir).startsWith('/home/runner/work/_temp/'));
const lines=readFileSync(statusPath,'utf8').split(/\r?\n/);
const env=Object.fromEntries(lines.filter(s=>/^[A-Z_]+=/i.test(s))
 .map(s=>{const i=s.indexOf('=');let v=s.slice(i+1);if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);return [s.slice(0,i),v]}));
const url=new URL(env.API_URL);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Only loopback Supabase API allowed');
assert.equal(url.protocol,'http:');
assert.ok((phase==='source'&&url.port==='56321')||(phase==='target'&&url.port==='57321'));
const adminKey=env.SERVICE_ROLE_KEY,anonKey=env.ANON_KEY;
assert.ok(adminKey&&anonKey,'Local CLI status must contain service_role and anon keys');
const sha=v=>createHash('sha256').update(v).digest('hex');
const email='v58-synthetic-migration@example.invalid';
const password='SyntheticV58Only!DoNotReuse2026';
const bucket='v58-synthetic-migration';
const key='dummy-fixture.txt';
const body=Buffer.from('Synthetic-only object payload for V5.8 Supabase Storage transfer.\n');
async function req(method,path,{admin=true,data=null,mime='application/json',expectBinary=false,token=null}={}){
 const auth=token??(admin?adminKey:anonKey);
 const headers={apikey:admin?adminKey:anonKey,Authorization:'Bearer '+auth};
 if(data!==null)headers['Content-Type']=mime;
 const r=await fetch(new URL(path,url),{method,headers,body:data,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Local Supabase '+method+' '+path.split('?')[0]+' failed (HTTP '+r.status+')');
 if(expectBinary)return Buffer.from(await r.arrayBuffer());
 const str=await r.text();if(!str)return {};
 try{return JSON.parse(str)}catch{throw Error('Local Supabase expected JSON response');}
}
async function signin(){
 return req('POST','/auth/v1/token?grant_type=password',{admin:false,
 data:JSON.stringify({email,password})});
}
async function storageCreate(){
 await req('POST','/storage/v1/bucket',{data:JSON.stringify({name:bucket,id:bucket,public:false})});
}
async function upload(){
 await req('POST','/storage/v1/object/'+bucket+'/'+key,{data:body,mime:'text/plain'});
 const data=await req('GET','/storage/v1/object/authenticated/'+bucket+'/'+key,{expectBinary:true});
 assert.equal(sha(data),sha(body),'Storage file content is not equal to uploaded fixture');
 return sha(data);
}
const stateFile=resolve(privateDir,'synthetic-state.json');
if(phase==='source'){
 const created=await req('POST','/auth/v1/admin/users',{data:JSON.stringify({
  email,password,email_confirm:true
 })});
 const id=created.id??created.user?.id;
 assert.match(id,/^[0-9a-f-]{36}$/i);
 const login=await signin();
 assert.equal(login.user?.id,id,'Auth login must keep original id');
 assert.ok(login.access_token&&login.refresh_token,'Auth session must be generated');
 await storageCreate();
 const objectHash=await upload();
 const state={sourceUserId:id,bucket,key,objectSha256:objectHash};
 writeFileSync(stateFile,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
 console.log('PASS: source local GoTrue user, identity/login session and actual Storage object created');
}else{
 const state=JSON.parse(readFileSync(stateFile,'utf8'));
 assert.equal(state.bucket,bucket);
 assert.equal(state.key,key);
 const login=await signin();
 assert.equal(login.user?.id,state.sourceUserId,'Auth identity id drift after managed-table migration');
 assert.ok(login.access_token&&login.refresh_token,'Restored Auth user cannot create session');
 await storageCreate();
 const objectHash=await upload();
 assert.equal(objectHash,state.objectSha256,'Storage object bytes differ after transfer');
 console.log('PASS: target local GoTrue login uses original synthetic user identity and creates fresh session');
 console.log('PASS: target Storage API creates metadata and exact-content transferred object');
 console.log('LIMIT: old session tokens cannot be assumed valid after changing JWT signing secrets');
}
