import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');
const start=source.indexOf('const LOGOUT_LOCK_KEY=');
const end=source.indexOf('const LIVE_TABLES=',start);
assert.ok(start>=0&&end>start);
const privacyFunctions=source.slice(start,end);

function harness(){
 const store=new Map(),events={};let cleaned=0,rendered=0,verified=0;
 const localStorage={
  getItem:k=>store.get(k)??null,
  setItem:(k,v)=>store.set(k,String(v)),
  removeItem:k=>store.delete(k)
 };
 const location=new URL('https://tutor.rapid4grad.com/v2/index.html?code=expired&v4invite='+'a'.repeat(64));
 const window={location,history:{replaceState(_x,_y,path){location.href=new URL(path,location.origin).href}},
  addEventListener:(name,handler)=>events[name]=handler};
 const document={body:{classList:{add(){}}}};
 const factory=new Function('localStorage','V4_CONFIG','window','document',
  'clearUserSessionState','render','showModal','initializeLive',
  "let authPhase='ready',activeUser={id:'old-parent'},signOutRequested=false,state={mode:'live'};\n"+
  privacyFunctions+"\nreturn {markLogout,allowGoogleLogin,logoutLocked,forgetCachedAuth,"+
  "scrubOAuthCallback,registerHistoryGuards,getUser:()=>activeUser,getPhase:()=>authPhase};");
 const api=factory(localStorage,{projectRef:'vctisuglfoxyuwlvyjee'},window,document,
  ()=>{cleaned++},()=>{rendered++},()=>{},()=>{verified++});
 return {api,store,events,window,counts:()=>({cleaned,rendered,verified})};
}
test('explicit signout persists across reload and only intentional login clears flag',()=>{
 const h=harness();
 h.api.markLogout();
 assert.equal(h.api.logoutLocked(),true);
 assert.equal(h.store.get('tutor_v4_explicit_logout'),'1');
 h.api.allowGoogleLogin();
 assert.equal(h.api.logoutLocked(),false);
 assert.equal(h.store.get('tutor_v4_explicit_logout'),'0');
});
test('stale OAuth callback code is removed without destroying valid invite',()=>{
 const h=harness();h.api.scrubOAuthCallback();
 assert.equal(h.window.location.search,'?v4invite='+'a'.repeat(64));
});
test('Auth session fallback deletes only this project storage key',()=>{
 const h=harness();
 h.store.set('sb-vctisuglfoxyuwlvyjee-auth-token','synthetic');
 h.store.set('sb-another-auth-token','untouched');
 h.api.forgetCachedAuth();
 assert.equal(h.store.has('sb-vctisuglfoxyuwlvyjee-auth-token'),false);
 assert.equal(h.store.get('sb-another-auth-token'),'untouched');
});
test('BFCache and other-tab logout cannot expose the previous account',()=>{
 const h=harness();h.api.registerHistoryGuards();h.api.markLogout();
 h.events.pagehide({persisted:true});
 h.events.pageshow({persisted:true});
 assert.equal(h.api.getUser(),null);
 assert.equal(h.api.getPhase(),'signedOut');
 assert.equal(h.counts().verified,0);
 h.events.storage({key:'tutor_v4_explicit_logout',newValue:'1'});
 assert.equal(h.api.getUser(),null);
});
test('new app init, auth event, and signout must all guard against stale sessions',()=>{
 assert.ok(source.includes('if(logoutLocked()){scrubOAuthCallback();showLogoutGate();return}'));
 assert.ok(source.includes('if(logoutLocked()){showLogoutGate();return}'));
 assert.ok(source.includes('markLogout();\n oauthCallbackIssue=""'));
 assert.ok(source.includes('forgetCachedAuth();signOutRequested=false;'));
 assert.ok(source.includes('registerHistoryGuards();'));
 assert.ok(source.includes('if(err?.name==="AuthSessionMissingError")'));
});
