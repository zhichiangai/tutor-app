import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";

const require=createRequire(import.meta.url);
const handler=require("../api/v4-config.js");
const original={...process.env};
const formalRef="vctisuglfoxyuwlvyjee";
const publishableKey="sb_publishable_synthetic_only";

function setEnv(values){
 for(const key of Object.keys(process.env))if(key.startsWith("VERCEL_")||key.startsWith("V4_PRODUCTION_")||key.startsWith("V4_PREVIEW_"))delete process.env[key];
 Object.assign(process.env,values);
}
function call(method,host){
 const res={headers:{},setHeader(name,value){this.headers[name]=value;},statusCode:0,end(body){this.body=JSON.parse(body);}};
 handler({method,headers:{host}},res);
 return res;
}
function restoreEnv(){
 for(const key of Object.keys(process.env))if(key.startsWith("VERCEL_")||key.startsWith("V4_PRODUCTION_")||key.startsWith("V4_PREVIEW_"))delete process.env[key];
 for(const [key,value] of Object.entries(original))if(key.startsWith("VERCEL_")||key.startsWith("V4_PRODUCTION_")||key.startsWith("V4_PREVIEW_"))process.env[key]=value;
}

test("production endpoint returns only public settings on exact production host",t=>{
 t.after(restoreEnv);
 setEnv({VERCEL_ENV:"production",V4_PRODUCTION_SUPABASE_PROJECT_REF:formalRef,
  V4_PRODUCTION_SUPABASE_URL:`https://${formalRef}.supabase.co`,V4_PRODUCTION_SUPABASE_PUBLISHABLE_KEY:publishableKey,
  V4_PRODUCTION_SUPABASE_SERVICE_ROLE:"must-not-be-returned"});
 const res=call("GET","tutor.rapid4grad.com");
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.body,{environment:"production",isolated:false,projectRef:formalRef,url:`https://${formalRef}.supabase.co`,publishableKey});
 assert.equal(res.headers["Cache-Control"],"no-store, max-age=0");
 assert.equal(JSON.stringify(res.body).includes("must-not-be-returned"),false);
});

test("production endpoint denies aliases, preview env, and invalid keys",t=>{
 t.after(restoreEnv);
 setEnv({VERCEL_ENV:"production",V4_PRODUCTION_SUPABASE_PROJECT_REF:formalRef,
  V4_PRODUCTION_SUPABASE_URL:`https://${formalRef}.supabase.co`,V4_PRODUCTION_SUPABASE_PUBLISHABLE_KEY:"service_role_not_valid"});
 assert.equal(call("GET","tutor-app-v2.vercel.app").statusCode,404);
 assert.equal(call("GET","tutor.rapid4grad.com").statusCode,503);
 process.env.VERCEL_ENV="preview";
 assert.equal(call("GET","tutor.rapid4grad.com").statusCode,404);
});

test("preview endpoint requires exact deployment host and non-production ref",t=>{
 t.after(restoreEnv);
 const ref="abcdefghijklmnopqrst";
 setEnv({VERCEL_ENV:"preview",VERCEL_URL:"preview-123.vercel.app",
  V4_PREVIEW_SUPABASE_PROJECT_REF:ref,V4_PREVIEW_SUPABASE_URL:`https://${ref}.supabase.co`,
  V4_PREVIEW_SUPABASE_PUBLISHABLE_KEY:publishableKey});
 const allowed=call("GET","preview-123.vercel.app");
 assert.equal(allowed.statusCode,200);
 assert.equal(allowed.body.isolated,true);
 assert.equal(allowed.body.environment,"preview");
 assert.equal(call("GET","other-preview.vercel.app").statusCode,404);
 process.env.V4_PREVIEW_SUPABASE_PROJECT_REF=formalRef;
 process.env.V4_PREVIEW_SUPABASE_URL=`https://${formalRef}.supabase.co`;
 assert.equal(call("GET","preview-123.vercel.app").statusCode,503);
});

test("endpoint allows only GET and never answers arbitrary hosts",t=>{
 t.after(restoreEnv);
 setEnv({VERCEL_ENV:"production"});
 assert.equal(call("POST","tutor.rapid4grad.com").statusCode,405);
 assert.equal(call("GET","example.com").statusCode,404);
});

test("Vercel keeps the config handler at the project root and does not rewrite API paths",()=>{
 const vercel=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
 const apiPath=new URL("../api/v4-config.js",import.meta.url);
 assert.equal(typeof handler,"function");
 assert.ok(readFileSync(apiPath,"utf8").includes("module.exports"));
 assert.ok(Array.isArray(vercel.rewrites));
 assert.equal(vercel.rewrites.some(({source=""})=>
  source==="/api"||source.startsWith("/api/")||source==="/:path*"||source==="/(.*)"),false);
});
