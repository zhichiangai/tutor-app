import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8");
const start=app.indexOf("const V4_CONFIG=");
const end=app.indexOf("const STORAGE =",start);
assert.ok(start>0&&end>start,"V4 backend guard must precede app state");
const guard=app.slice(start,end);
const localKey="eyJhbGciOiJIUzI1NiJ9.local.signature";
const local={isolated:true,projectRef:"local",url:"http://127.0.0.1:54321",publishableKey:localKey};
function check(config,hostname="localhost",protocol="http:"){
 return Function("window",guard+";return {valid:V4_CONFIG_VALID,url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY};")({
  V4_BACKEND:config,location:{hostname,protocol}
 });
}

test("V4 remains disabled by default",()=>{
 assert.deepEqual(check({isolated:false,projectRef:"",url:"",publishableKey:""}),{valid:false,url:"",key:""});
});
test("local Supabase connects only from a local HTTP website",()=>{
 assert.equal(check(local).url,"http://127.0.0.1:54321");
 assert.equal(check({...local,url:"http://localhost:54321"},"127.0.0.1").valid,true);
 for(const host of ["tutor.rapid4grad.com","example.test"]){
  assert.equal(check(local,host,"https:").valid,false);
 }
 assert.equal(check(local,"localhost","https:").valid,false);
});
test("local mode cannot be redirected to a remote or LAN API",()=>{
 for(const url of ["https://vctisuglfoxyuwlvyjee.supabase.co","http://192.168.1.5:54321","http://127.0.0.1:54322"]){
  assert.equal(check({...local,url}).valid,false,url);
 }
 assert.equal(check({...local,projectRef:"vctisuglfoxyuwlvyjee"}).valid,false);
 assert.equal(check({...local,isolated:false}).valid,false);
});
test("remote staging still requires a different project and publishable key",()=>{
 const stagingRef="abcdefghijklmnopqrst";
 const staging={isolated:true,projectRef:stagingRef,url:"https://"+stagingRef+".supabase.co",
  publishableKey:"sb_publishable_staging_example"};
 assert.equal(check(staging,"staging.example.test","https:").valid,true);
 assert.equal(check({...staging,projectRef:"vctisuglfoxyuwlvyjee",
  url:"https://vctisuglfoxyuwlvyjee.supabase.co"},"staging.example.test","https:").valid,false);
 assert.equal(check({...staging,publishableKey:localKey},"staging.example.test","https:").valid,false);
});
