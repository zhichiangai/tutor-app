// RAP-12 localhost-only UI host and role chooser for disposable GoTrue identities.
// Production URLs, external OAuth, service-role keys and real user records are forbidden.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const file=process.env.RAP12_FIXTURE_FILE;
assert.equal(process.env.V4_E2E_LOCAL,'1');
assert.equal(process.env.RAP12_TEAM_GUI_LOCAL,'1');
assert.ok(file&&existsSync(file),'Run seed-rap12-team-local.mjs first');
assert.match(readFileSync(root+'supabase/config.toml','utf8'),
 /^project_id = "tutor_v4_isolated"$/m);
assert.equal(existsSync(root+'supabase/.temp/project-ref'),false,
 'Never host local QA from a linked Supabase checkout');
const fixture=JSON.parse(readFileSync(file,'utf8'));
assert.equal(fixture.environment,'local');
assert.equal(fixture.apiUrl,'http://127.0.0.1:54321');
assert.equal(fixture.baseUrl,'http://127.0.0.1:3000');
const sdk=readFileSync(root+'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const localInit='<script>window.V4_LOCAL_BACKEND='+JSON.stringify({
 environment:'local',isolated:true,projectRef:'local',url:fixture.apiUrl,
 publishableKey:fixture.anonKey
}).replace(/</g,'\\u003c')+';</script>';
const roleLabels={
 managerA:'Team A 管理者',teacherA:'Team A 指派老師',unassignedA:'Team A 未指派老師',
 studentA1:'Team A 學生 D',studentA2:'Team A 學生 E',
 managerB:'Team B 管理者',teacherB:'Team B 指派老師',studentB:'Team B 學生 H'
};
const roleButtons=Object.entries(roleLabels).map(([key,name])=>
 '<button type="button" data-role="'+key+'">'+name+'</button>').join('\n');
const chooser=[
 '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">',
 '<meta name="viewport" content="width=device-width,initial-scale=1">',
 '<title>RAP-12 本機合成身分選擇</title>',
 '<style>body{font:16px system-ui;margin:2rem;max-width:42rem}',
 'button{display:block;margin:1rem 0;padding:1rem;min-height:44px}',
 'p{line-height:1.6}#status{font-weight:bold}</style></head><body>',
 '<h1>RAP-12｜本機隔離 GUI</h1>',
 '<p>僅限 127.0.0.1 的合成帳號。不是正式網站或 Google 登入。',
 '此頁不顯示、不要求輸入任何密碼與 Token。</p>',
 roleButtons,'<p id="status" role="status">選擇合成測試身分。</p>',
 '<script src="/__rap12/sdk.js"></script>',
 '<script>',
 'document.querySelectorAll("button[data-role]").forEach(button=>{',
 ' button.addEventListener("click",async()=>{',
 '  const status=document.getElementById("status");',
 '  status.textContent="正在登入本機合成身分";',
 '  document.querySelectorAll("button").forEach(b=>b.disabled=true);',
 '  try{',
 '   const response=await fetch("/__rap12/login",{method:"POST",',
 '    headers:{"content-type":"application/json"},',
 '    body:JSON.stringify({role:button.dataset.role})});',
 '   if(!response.ok)throw Error("Local test login unavailable");',
 '   const tokens=await response.json();',
 '   const db=window.supabase.createClient("http://127.0.0.1:54321",'+
       JSON.stringify(fixture.anonKey)+',{',
 '    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});',
 '   const {error}=await db.auth.setSession(tokens);',
 '   if(error)throw Error("Disposable local session failed");',
 '   db.auth.stopAutoRefresh?.();',
 '   localStorage.setItem("tutor_v4_explicit_logout","0");',
 '   location.replace("/v2/index.html");',
 '  }catch(e){status.textContent="本機登入失敗；請檢查隔離服務及 fixture";',
 '   document.querySelectorAll("button").forEach(b=>b.disabled=false);}',
 ' });',
 '});',
 '</script></body></html>'
].join('\n');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.webp':'image/webp','.ico':'image/x-icon',
 '.json':'application/json; charset=utf-8'};
function send(res,code,body,type='text/plain; charset=utf-8'){
 res.writeHead(code,{'content-type':type,'cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 res.end(body);
}
const server=createServer(async(req,res)=>{
 // Never answer LAN aliases, proxy Host rewrites or remote Origin calls.
 if(req.headers.host!=='127.0.0.1:3000')return send(res,403,'Local only');
 const address=new URL(req.url,'http://127.0.0.1:3000').pathname;
 if(req.method==='POST'&&address==='/__rap12/login'){
  if(req.headers.origin!=='http://127.0.0.1:3000')
   return send(res,403,'Same origin required');
  let input='';
  for await(const chunk of req){
   input+=chunk;
   if(input.length>1024)return send(res,413,'Too large');
  }
  let role;
  try{role=JSON.parse(input).role}catch{return send(res,400,'Bad request')}
  if(!Object.hasOwn(roleLabels,role))return send(res,400,'Unknown role');
  try{
   const user=fixture.actors[role];
   const response=await fetch(fixture.apiUrl+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{apikey:fixture.anonKey,
     'content-type':'application/json'},
    body:JSON.stringify({email:user.email,password:user.password})
   });
   if(!response.ok)return send(res,503,'Local GoTrue unavailable');
   const result=await response.json();
   // Only disposable localhost GoTrue session tokens go to this same-origin browser.
   return send(res,200,JSON.stringify({access_token:result.access_token,
    refresh_token:result.refresh_token}),'application/json; charset=utf-8');
  }catch{return send(res,503,'Local QA login failed')}
 }
 if(req.method!=='GET')return send(res,405,'Unsupported method');
 if(address==='/'||address==='/__rap12') {
  res.writeHead(302,{location:'/__rap12/','cache-control':'no-store'});return res.end();
 }
 if(address==='/__rap12/'||address==='/__rap12/index.html')
  return send(res,200,chooser,'text/html; charset=utf-8');
 if(address==='/__rap12/sdk.js')
  return send(res,200,sdk,'text/javascript; charset=utf-8');
 // Serve ONLY existing production frontend assets. Never serve .git, fixture,
 // SQL, docs, /tmp, local QA secret files or source outside v2/.
 if(!address.startsWith('/v2/'))return send(res,404,'Not found');
 const filename=resolve(root,'.'+address);
 if(!filename.startsWith(resolve(root,'v2')+'/'))return send(res,403,'Denied');
 const mime=types[extname(filename)];
 if(!mime)return send(res,404,'Unsupported asset');
 try{
  let body=readFileSync(filename);
  if(address==='/v2/index.html'){
   let html=body.toString('utf8');
   html=html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.76\.1\/dist\/umd\/supabase\.js/g,
    '/__rap12/sdk.js');
   html=html.replace(/<head([^>]*)>/i,'<head$1>'+localInit);
   body=html;
  }
  return send(res,200,body,mime);
 }catch{return send(res,404,'Missing asset')}
});
server.listen(3000,'127.0.0.1',()=>{
 console.log('RAP12_LOCAL_GUI_READY http://127.0.0.1:3000/__rap12/');
});
