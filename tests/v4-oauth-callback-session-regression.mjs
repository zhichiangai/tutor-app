// Offline regression for OAuth callback errors and authenticated data-load retry.
// No Google credentials, real sessions, network requests or writes.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const appCode=readFileSync(new URL("../v2/app.js",import.meta.url),"utf8")
 .replace(/^import .* from "\.\/[^"]+";/gm,"")
 .replace(/\nmain\(\);\s*$/,"");

function harness(href="https://tutor.rapid4grad.com/v2/index.html"){
 const location=new URL(href);
 const replaced=[];
 const window={location,history:{replaceState(_state,_title,path){
  replaced.push(path);
  const next=new URL(path,location.origin);
  location.href=next.href;
 }}};
 const dom=new Map();
 const node=selector=>{
  if(!dom.has(selector)){
   const attrs=new Map();
   dom.set(selector,{
    textContent:"",innerHTML:"",value:"",hidden:false,disabled:false,open:false,
    style:{},classList:{add(){},remove(){},contains(){return false},toggle(){}},
    setAttribute(k,v){attrs.set(k,String(v))},
    getAttribute:k=>attrs.get(k),
    reset(){},showModal(){this.open=true},close(){this.open=false}
   });
  }
  return dom.get(selector);
 };
 const document={querySelector:node,querySelectorAll:()=>[],
  body:{classList:{toggle(){}}},activeElement:null};
 const storage=new Map();
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))};
 const additions=String.raw`
  render=()=>renderAuthUI();
  toast=()=>{};
  ensureMyProfile=async()=>{};
  let failData=false;
  refreshLive=async()=>{
   if(failData)throw Error("Synthetic RLS data failure: no token loss");
   state.profiles=[{id:"qa-teacher",roles_configured:true,enabled_roles:["teacher"],last_role:"teacher"}];
   state.workspaces=[{owner_id:"qa-teacher",id:"qa-workspace",name:"Test-only"}];
  };
  loadSharedCourseHistory=async()=>{};
  loadTeacherPreferences=async()=>{};
  return {state,oauthRedirectUrl,captureOAuthCallbackError,initializeLive,googleLogin,renderAuthUI,
   setClient(x){client=x},setFail(x){failData=x},
   user(){return activeUser},phase(){return authPhase},issue(){return oauthCallbackIssue}};
`;
 const api=new Function("document","localStorage","window","location","crypto","setTimeout","FormData",
  appCode+"\n"+additions)(document,localStorage,window,location,
  {randomUUID:()=> "qa-only-id"},setTimeout,FormData);
 return {api,node,location,replaced,storage};
}
const token="a".repeat(64);

test("new OAuth redirect is canonical and never preserves stale error or arbitrary search",()=>{
 const h=harness("https://tutor.rapid4grad.com/v2/index.html?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired&from=evil");
 assert.equal(h.api.oauthRedirectUrl(),"https://tutor.rapid4grad.com/v2/index.html");
});
test("valid V4 invitation token survives OAuth while untrusted query keys do not",()=>{
 const h=harness("https://tutor.rapid4grad.com/?v4invite="+token+"&error_code=bad_oauth_state&debug=x");
 assert.equal(h.api.oauthRedirectUrl(),"https://tutor.rapid4grad.com/v2/index.html?v4invite="+token);
 assert.equal(harness("https://tutor.rapid4grad.com/v2/index.html?v4invite=short").api.oauthRedirectUrl(),
  "https://tutor.rapid4grad.com/v2/index.html");
});
test("expired OAuth query is consumed once with a safe message and URL cleanup",async()=>{
 const h=harness("https://tutor.rapid4grad.com/v2/index.html?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired&v4invite="+token);
 h.api.setClient({auth:{getSession:async()=>({data:{session:null},error:null})}});
 await h.api.initializeLive();
 assert.equal(h.api.phase(),"signedOut");
 assert.match(h.node("#login-description").textContent,/登入已逾時/);
 assert.equal(h.node("#google-login").hidden,false,"User can restart OAuth");
 assert.equal(h.replaced.length,1);
 assert.equal(h.replaced[0],"/v2/index.html?v4invite="+token);
 assert.ok(!h.location.search.includes("error"),"Only invitation remains in address");
});
test("OAuth errors in URL fragment are consumed but a session token fragment is untouched",()=>{
 const h=harness("https://tutor.rapid4grad.com/v2/index.html#error=invalid_request&error_code=bad_oauth_state");
 assert.match(h.api.captureOAuthCallbackError(),/登入已逾時/);
 assert.equal(h.replaced[0],"/v2/index.html");
 const good=harness("https://tutor.rapid4grad.com/v2/index.html?code=qa-placeholder#access_token=redacted-test");
 assert.equal(good.api.captureOAuthCallbackError(),"");
 assert.equal(good.replaced.length,0,"Supabase callback must keep authentication parameters");
});
test("Google button uses canonical redirect without corrupting invitation deep links",async()=>{
 const h=harness("https://tutor.rapid4grad.com/?v4invite="+token+"&error=invalid_request");
 let captured;
 h.api.setClient({auth:{signInWithOAuth:async options=>{
  captured=options;
  return {error:null};
 }}});
 await h.api.googleLogin();
 assert.equal(captured.provider,"google");
 assert.equal(captured.options.redirectTo,"https://tutor.rapid4grad.com/v2/index.html?v4invite="+token);
});
test("data refresh failure retains verified Google identity and permits session-only retry",async()=>{
 const h=harness();
 let googleAuthorizations=0, sessionReads=0;
 h.api.setClient({auth:{
  getSession:async()=>{sessionReads++;return {data:{session:{user:{id:"qa-teacher",email:"qa@example.invalid"}}},error:null}},
  signInWithOAuth:async()=>{googleAuthorizations++;return {error:null}}
 }});
 h.api.setFail(true);
 await h.api.initializeLive();
 assert.equal(h.api.phase(),"error");
 assert.equal(h.api.user()?.id,"qa-teacher","Verified session must not be erased by a data error");
 assert.equal(h.node("#login-retry").hidden,false);
 assert.match(h.node("#login-description").textContent,/Google 登入已完成/);
 assert.match(h.node("#login-description").textContent,/不需要重新選擇帳號/);
 assert.equal(h.api.state.students.length,0,"Never show partially loaded private rows");
 h.api.setFail(false);
 await h.api.initializeLive();
 assert.equal(h.api.phase(),"ready");
 assert.equal(h.api.user()?.id,"qa-teacher");
 assert.equal(googleAuthorizations,0,"Data retry must not trigger another OAuth login");
 assert.equal(sessionReads,2);
});
test("missing or invalid session still blocks access and offers non-OAuth retry",async()=>{
 const h=harness();
 h.api.setClient({auth:{getSession:async()=>({data:{session:null},error:new Error("Synthetic token failure")})}});
 await h.api.initializeLive();
 assert.equal(h.api.phase(),"error");
 assert.equal(h.api.user(),null);
 assert.equal(h.node("#login-retry").hidden,false);
 assert.equal(h.node("#google-login").hidden,true);
});
