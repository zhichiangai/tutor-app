// Offline behavior tests of the actual V4 Google Apps Script mail queue.
// All Google, UrlFetch and Gmail APIs are mocked. NEVER sends a real email.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const worker=readFileSync(
  new URL('../integrations/google-apps-script/v4-notifications/Code.gs',import.meta.url),
  'utf8'
);
const stagingRef='aaaaaaaaaaaaaaaaaaaa';
const defaults={
  V4_STAGING_PROJECT_REF:stagingRef,
  V4_BRIDGE_URL:'https://'+stagingRef+'.supabase.co/functions/v1/v4-gas-bridge',
  V4_BRIDGE_SECRET:'qa-only-mocked-not-a-credential-000000000000',
  V4_FROM_EMAIL:'tutor-notify@rapid4grad.com',
  V4_TEST_RECIPIENTS:'qa@example.invalid',
  V4_MAIL_ENABLED:'true'
};
const message={
  id:'11111111-1111-4111-8111-111111111111',
  lease_token:'22222222-2222-4222-8222-222222222222',
  recipient:'qa@example.invalid',
  subject:'好好上課測試通知',
  body:'Synthetic message body'
};

function harness({props={},mails=[],ackFailures=0,aliases=[],email='tutor-notify@rapid4grad.com',quota=20}={}){
  const store=new Map(Object.entries({...defaults,...props}));
  const sent=[],posts=[],logs=[],claimed=[...mails];
  let remainingAckFailures=ackFailures;
  const scriptProperties={
    getProperty:key=>store.has(key)?store.get(key):null,
    setProperty:(key,value)=>{store.set(key,value);},
    deleteProperty:key=>{store.delete(key);},
    getProperties:()=>Object.fromEntries(store)
  };
  const globals={
    Session:{getEffectiveUser:()=>({getEmail:()=>email})},
    GmailApp:{
      getAliases:()=>aliases,
      sendEmail:(to,subject,body,options)=>sent.push({to,subject,body,options})
    },
    MailApp:{getRemainingDailyQuota:()=>quota},
    PropertiesService:{getScriptProperties:()=>scriptProperties},
    UrlFetchApp:{fetch:(url,options)=>{
      const payload=JSON.parse(options.payload);
      posts.push({url,payload});
      const fail=payload.action==='ack'&&remainingAckFailures-->0;
      const body=payload.action==='claim'?{messages:claimed.splice(0,1)}:{acknowledged:true};
      return {getResponseCode:()=>fail?503:200,getContentText:()=>JSON.stringify(body)};
    }},
    LockService:{getScriptLock:()=>({
      tryLock:()=>true,waitLock:()=>{},releaseLock:()=>{}
    })},
    ScriptApp:{getProjectTriggers:()=>[],newTrigger:()=>{throw Error('No real triggers allowed');}},
    console:{log:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}
  };
  runInNewContext(worker,globals,{filename:'Code.gs'});
  return {globals,store,sent,posts,logs};
}

test('mail disabled: no bridge fetch, no Gmail send, no trigger',()=>{
  const h=harness({props:{V4_MAIL_ENABLED:'false'}});
  assert.throws(()=>h.globals.processV4MailQueue(),/尚未啟用/);
  assert.equal(h.posts.length,0);
  assert.equal(h.sent.length,0);
});
test('production Supabase ref cannot be used by staging GAS worker',()=>{
  const ref='vctisuglfoxyuwlvyjee';
  const h=harness({props:{
    V4_STAGING_PROJECT_REF:ref,
    V4_BRIDGE_URL:'https://'+ref+'.supabase.co/functions/v1/v4-gas-bridge'
  }});
  assert.throws(()=>h.globals.processV4MailQueue(),/隔離測試專案/);
  assert.equal(h.posts.length,0);
});
test('allowlisted synthetic email is sent once and ACKed, without a saved journal',()=>{
  const h=harness({mails:[message]});
  h.globals.processV4MailQueue();
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].to,message.recipient);
  assert.deepEqual(h.posts.map(x=>x.payload.action),['claim','ack','claim']);
  const ack=h.posts.find(x=>x.payload.action==='ack').payload;
  assert.equal(ack.ok,true);
  assert.equal(ack.uncertain,false);
  assert.equal(ack.id,message.id);
  assert.equal(ack.lease,message.lease_token);
  assert.equal([...h.store.keys()].filter(k=>k.startsWith('V4_DELIVERY_')).length,0);
});
test('recipient outside QA allowlist is never mailed; outcome marked uncertain',()=>{
  const h=harness({mails:[{...message,recipient:'not-allowlisted@example.invalid'}]});
  h.globals.processV4MailQueue();
  assert.equal(h.sent.length,0);
  const ack=h.posts.find(x=>x.payload.action==='ack').payload;
  assert.equal(ack.ok,false);
  assert.equal(ack.uncertain,true);
});
test('ACK failure preserves journal and next run retries ACK without resending',()=>{
  const h=harness({mails:[message],ackFailures:1});
  assert.throws(()=>h.globals.processV4MailQueue(),/暫時無法確認/);
  assert.equal(h.sent.length,1);
  const journalKey='V4_DELIVERY_'+message.id;
  assert.equal(JSON.parse(h.store.get(journalKey)).state,'sent');
  h.globals.processV4MailQueue();
  assert.equal(h.sent.length,1,'ACK retry must never send another email');
  assert.equal(h.store.has(journalKey),false);
  assert.equal(h.posts.filter(x=>x.payload.action==='ack').length,2);
});
test('crashed-before-send journal becomes uncertain, never sends automatically',()=>{
  const key='V4_DELIVERY_'+message.id;
  const h=harness({props:{[key]:JSON.stringify({
    id:message.id,lease:message.lease_token,state:'started'
  })}});
  h.globals.processV4MailQueue();
  assert.equal(h.sent.length,0);
  assert.equal(h.store.has(key),false);
  const ack=h.posts.find(x=>x.payload.action==='ack').payload;
  assert.equal(ack.ok,false);
  assert.equal(ack.uncertain,true);
});
test('read-only sender inspection never reports bridge secret',()=>{
  const h=harness();
  const report=h.globals.inspectV4MailSettings();
  assert.equal(report.senderAvailable,true);
  assert.equal(report.aliasCount,0);
  assert.equal(JSON.stringify(report).includes(h.store.get('V4_BRIDGE_SECRET')),false);
  assert.equal(h.sent.length,0);
  assert.equal(h.posts.length,0);
});
