import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const connections=read("v2/v4-connections.js");
const app=read("v2/app.js");
const confirm=read("v2/site-confirm.js");

function bodyOf(source,name){
 const start=source.indexOf("async function "+name);
 assert.notEqual(start,-1,"function exists: "+name);
 const next=source.indexOf("\nasync function ",start+1);
 return source.slice(start,next===-1?source.length:next);
}

test("V4 guardian unlink uses the in-site confirmation flow",()=>{
 assert.doesNotMatch(connections,/window\.confirm/);
 assert.match(connections,/window\.__tutorSiteConfirm/);
 assert.match(connections,/確認解除課程連結/);
 assert.match(connections,/保留連結/);
 assert.match(connections,/已完成課程、付款與稽核紀錄仍會保留/);
 assert.match(connections,/正在解除/);
 assert.match(connections,/await rpc\("v4_disconnect_guardian"/);
});

test("teacher account and guardian revocation paths share the same site confirmation",()=>{
 for(const name of ["revokeManagedStudentAccount","revokeInvite"]){
  const body=bodyOf(app,name);
  assert.doesNotMatch(body,/window\.confirm|\bconfirm\(/);
  assert.match(body,/confirmSiteAction/);
  assert.match(body,/操作未完成/);
 }
});

test("site confirmation manages focus, escape/cancel, busy state and failed actions",()=>{
 assert.match(confirm,/showModal/);
 assert.match(confirm,/previousFocus/);
 assert.match(confirm,/event\.preventDefault\(\)/);
 assert.match(confirm,/active\.busy/);
 assert.match(confirm,/submit\.disabled = true/);
 assert.match(confirm,/catch \(err\)/);
 assert.match(confirm,/error\.hidden = false/);
});
