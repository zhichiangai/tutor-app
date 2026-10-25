import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../v2/v4-config.js",import.meta.url),"utf8");
const productionRef="vctisuglfoxyuwlvyjee";
const publicKey="sb_publishable_synthetic_only";
const local={environment:"local",isolated:true,projectRef:"local",url:"http://127.0.0.1:54321",publishableKey:"eyJhbGciOiJIUzI1NiJ9.synthetic.signature"};
const preview={environment:"preview",isolated:true,projectRef:"abcdefghijklmnopqrst",url:"https://abcdefghijklmnopqrst.supabase.co",publishableKey:publicKey};
const production={environment:"production",isolated:false,projectRef:productionRef,url:`https://${productionRef}.supabase.co`,publishableKey:publicKey};

async function boot(location,{localBackend=null,response=null}={}){
 const calls=[];
 const window={location,V4_LOCAL_BACKEND:localBackend,fetch:async(...args)=>{calls.push(args);return response;}};
 runInNewContext(source,{window});
 await window.V4_CONFIG_READY;
 return {config:window.V4_BACKEND,error:window.V4_CONFIG_ERROR,calls};
}
const jsonResponse=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});

test("localhost accepts only explicit localhost Supabase configuration",async()=>{
 const valid=await boot({hostname:"localhost",protocol:"http:"},{localBackend:local});
 assert.equal(valid.config.projectRef,"local");
 assert.equal(valid.calls.length,0);
 for(const config of [null,{...local,url:"https://vctisuglfoxyuwlvyjee.supabase.co"},{...local,projectRef:productionRef},
  {...local,url:"http://192.168.1.4:54321"},{...local,isolated:false}]){
  const result=await boot({hostname:"localhost",protocol:"http:"},{localBackend:config});
  assert.equal(result.config,null);
  assert.match(result.error,/本機測試資料庫設定無效/);
 }
});

test("production configuration is fetched only on the exact production HTTPS hostname",async()=>{
 const ok=await boot({hostname:"tutor.rapid4grad.com",protocol:"https:"},{response:jsonResponse(production)});
 assert.deepEqual(ok.config,production);
 assert.equal(ok.calls.length,1);
 assert.equal(ok.calls[0][0],"/api/v4-config");
 assert.equal(ok.calls[0][1].credentials,"omit");
 assert.equal(ok.calls[0][1].cache,"no-store");
 const productionAlias=await boot({hostname:"tutor-app-v2.vercel.app",protocol:"https:"},{response:jsonResponse(production,404)});
 assert.equal(productionAlias.config,null);
 assert.equal(productionAlias.calls.length,1);
 for(const location of [
  {hostname:"evil-tutor.rapid4grad.com",protocol:"https:"},
  {hostname:"tutor.rapid4grad.com",protocol:"http:"}
 ]){
  const denied=await boot(location,{response:jsonResponse(production)});
  assert.equal(denied.config,null);
  assert.equal(denied.calls.length,0);
 }
});

test("production rejects wrong project, isolated flag, malformed key, and missing env",async()=>{
 for(const candidate of [
  {...production,projectRef:"abcdefghijklmnopqrst",url:"https://abcdefghijklmnopqrst.supabase.co"},
  {...production,isolated:true},
  {...production,publishableKey:"service_role_should_never_appear"}
 ]){
  const denied=await boot({hostname:"tutor.rapid4grad.com",protocol:"https:"},{response:jsonResponse(candidate)});
  assert.equal(denied.config,null);
  assert.match(denied.error,/正式資料庫設定未通過/);
 }
 const missing=await boot({hostname:"tutor.rapid4grad.com",protocol:"https:"},{response:jsonResponse({error:"production_configuration_unavailable"},503)});
 assert.equal(missing.config,null);
 assert.match(missing.error,/正式登入設定尚未就緒/);
});

test("Preview accepts only a non-production isolated project on a Vercel hostname",async()=>{
 const ok=await boot({hostname:"tutor-app-preview-abc.vercel.app",protocol:"https:"},{response:jsonResponse(preview)});
 assert.deepEqual(ok.config,preview);
 const denied=await boot({hostname:"tutor-app-preview-abc.vercel.app",protocol:"https:"},{response:jsonResponse({...preview,projectRef:productionRef,url:`https://${productionRef}.supabase.co`})});
 assert.equal(denied.config,null);
 assert.match(denied.error,/Preview 資料庫未通過隔離檢查/);
 const missing=await boot({hostname:"tutor-app-preview-abc.vercel.app",protocol:"https:"},{response:jsonResponse({error:"isolated_preview_configuration_unavailable"},503)});
 assert.equal(missing.config,null);
 assert.match(missing.error,/Preview 尚未設定隔離測試資料庫/);
});

test("unknown hosts never request configuration and fail closed",async()=>{
 const denied=await boot({hostname:"example.com",protocol:"https:"},{response:jsonResponse(preview)});
 assert.equal(denied.config,null);
 assert.equal(denied.calls.length,0);
 assert.match(denied.error,/此網站網域不允許/);
});
