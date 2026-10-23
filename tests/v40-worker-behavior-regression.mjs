import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const gas=read('integrations/google-apps-script/v4-notifications/Code.gs');
function worker({alias=true,quota=20,ackFails=0,sendThrows=false}={}){
 const properties=new Map(Object.entries({V4_BRIDGE_URL:'https://abcdefghijklmnopqrst.supabase.co/functions/v1/v4-gas-bridge',
 V4_BRIDGE_SECRET:'x'.repeat(48),V4_FROM_EMAIL:'tutor-notify@rapid4grad.com',V4_STAGING_PROJECT_REF:'abcdefghijklmnopqrst',
 V4_TEST_RECIPIENTS:'qa@example.test',V4_MAIL_ENABLED:'true'}));
 let sent=0,claims=0,acks=0,released=0,triggerCount=0,served=false;
 const prop={getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)};
 const context=vm.createContext({console:{log(){},error(){}},PropertiesService:{getScriptProperties:()=>prop},
 Session:{getEffectiveUser:()=>({getEmail:()=> 'operator@example.test'})},MailApp:{getRemainingDailyQuota:()=>quota},
 GmailApp:{getAliases:()=>alias?['tutor-notify@rapid4grad.com']:[],sendEmail(to,subject,body,options){sent++;assert.equal(options.from,'tutor-notify@rapid4grad.com');assert.equal(options.name,'好好上課');if(sendThrows)throw Error('ambiguous transport');}},
 LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){released++;}})},
 ScriptApp:{getProjectTriggers:()=>triggerCount?[{getHandlerFunction:()=> 'processV4MailQueue'}]:[],newTrigger:()=>({timeBased:()=>({everyMinutes:n=>{assert.equal(n,5);return {create(){triggerCount++;}};}})})},
 UrlFetchApp:{fetch(url,opts){const args=JSON.parse(opts.payload);let body={};
  if(args.action==='claim'){claims++;body={messages:served?[]:[{id:'00000000-0000-4000-8000-000000000001',lease_token:'00000000-0000-4000-8000-000000000002',recipient:'qa@example.test',subject:'QA',body:'No private data'}]};served=true;}
  if(args.action==='ack'){acks++;assert.ok(args.lease);if(ackFails-->0)throw Error('ACK unavailable');body={acknowledged:true};}
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)};}}});
 vm.runInContext(gas,context);
 return {context,properties,stats:()=>({sent,claims,acks,released,triggerCount})};
}
test('GAS inspection requires no bridge secrets and does not send',()=>{
 const w=worker();w.properties.clear();const r=w.context.inspectV4MailSettings();assert.equal(r.senderAvailable,true);assert.equal(r.remainingRecipients,20);assert.equal(w.stats().sent,0);
});
test('GAS refuses absent alias before claiming messages',()=>{
 const w=worker({alias:false});assert.throws(()=>w.context.processV4MailQueue());assert.equal(w.stats().claims,0);assert.equal(w.stats().released,1);
});
test('GAS quota exhaustion never claims a queue lease',()=>{
 const w=worker({quota:0});assert.throws(()=>w.context.processV4MailQueue());assert.equal(w.stats().claims,0);
});
test('GAS ACK failure after send persists journal and retries only ACK',()=>{
 const w=worker({ackFails:1});assert.throws(()=>w.context.processV4MailQueue());assert.equal(w.stats().sent,1);
 assert.ok([...w.properties.keys()].some(k=>k.startsWith('V4_DELIVERY_')));
 w.context.processV4MailQueue();assert.equal(w.stats().sent,1);assert.equal(w.stats().acks,2);
 assert.equal([...w.properties.keys()].some(k=>k.startsWith('V4_DELIVERY_')),false);
});
test('GAS ambiguous send is acknowledged uncertain and never immediately resent',()=>{
 const w=worker({sendThrows:true});w.context.processV4MailQueue();w.context.processV4MailQueue();assert.equal(w.stats().sent,1);
});
test('GAS sending is disabled by default and production project is rejected',()=>{
 const w=worker();w.properties.delete('V4_MAIL_ENABLED');assert.throws(()=>w.context.processV4MailQueue());assert.equal(w.stats().claims,0);
 w.properties.set('V4_MAIL_ENABLED','true');w.properties.set('V4_STAGING_PROJECT_REF','vctisuglfoxyuwlvyjee');assert.throws(()=>w.context.processV4MailQueue());assert.equal(w.stats().claims,0);
});
test('GAS trigger installation is locked and rejects duplicates',()=>{
 const w=worker();w.context.installV4MailTrigger();assert.throws(()=>w.context.installV4MailTrigger());assert.equal(w.stats().triggerCount,1);
});
function bridge({ref='abcdefghijklmnopqrst'}={}){
 let handler;let calls=0;
 const env={SUPABASE_URL:'https://'+ref+'.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-test-value',V4_GAS_BRIDGE_SECRET:'x'.repeat(48),V4_STAGING_PROJECT_REF:ref};
 const ctx=vm.createContext({Deno:{env:{get:k=>env[k]},serve:h=>handler=h},Response,Request,console:{error(){}},fetch:async()=>{calls++;return new Response('[]',{status:200});}});
 vm.runInContext(stripTypeScriptTypes(read('supabase/functions/v4-gas-bridge/index.ts')),ctx);
 const request=(body,headers={})=>handler(new Request('https://test.invalid',{method:'POST',headers:{'x-v4-mail-key':'x'.repeat(48),...headers},body:JSON.stringify(body)}));
 return {request,calls:()=>calls};
}
test('Edge bridge denies absent key, browser Origin and malformed ACK without RPC',async()=>{
 const b=bridge();assert.equal((await b.request({action:'claim',limit:1},{'x-v4-mail-key':''})).status,401);
 assert.equal((await b.request({action:'claim',limit:1},{origin:'https://site.invalid'})).status,403);
 assert.equal((await b.request({action:'ack',id:'bad',lease:'bad',ok:true,uncertain:false})).status,400);assert.equal(b.calls(),0);
});
test('Edge bridge rejects fractional claim sizes and production even with correct secret',async()=>{
 const b=bridge();assert.equal((await b.request({action:'claim',limit:1.5})).status,400);
 const prod=bridge({ref:'vctisuglfoxyuwlvyjee'});assert.equal((await prod.request({action:'claim',limit:1})).status,503);assert.equal(prod.calls(),0);
});
test('Edge bridge accepts authenticated bounded claim only for staging',async()=>{
 const b=bridge();assert.equal((await b.request({action:'claim',limit:1})).status,200);assert.equal(b.calls(),1);
});
const ui=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(read('v2/v4-connections.js')));
test('manual invitation input accepts opaque token and rejects off-origin URLs',()=>{
 const token='a'.repeat(64),origin='https://qa.example.test';assert.equal(ui.invitationToken(token,origin),token);
 assert.equal(ui.invitationToken(origin+'/?v4invite='+token,origin),token);
 assert.throws(()=>ui.invitationToken('https://evil.example/?v4invite='+token,origin));
 assert.throws(()=>ui.invitationToken(origin+'/?v4invite=bad',origin));
});
test('dev frontend public configuration never defaults to production',()=>{
 const prefix=read('v2/app.js').split('const STORAGE')[0].replace(/^import .*$/gm,'');
 const config=backend=>new Function('window',prefix+'return {url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY};')({V4_BACKEND:backend});
 assert.equal(config(undefined).url,'');
 assert.equal(config({isolated:true,projectRef:'vctisuglfoxyuwlvyjee',url:'https://vctisuglfoxyuwlvyjee.supabase.co',publishableKey:'sb_publishable_qa'}).url,'');
 const ref='abcdefghijklmnopqrst';assert.equal(config({isolated:true,projectRef:ref,url:'https://'+ref+'.supabase.co',publishableKey:'sb_publishable_qa'}).url,'https://'+ref+'.supabase.co');
});
