// Private V5.1 operator API — PREVIEW + isolated Supabase only.
// Never expose service credentials, JWTs, or student/payment records.
const PRODUCTION_REF='vctisuglfoxyuwlvyjee';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLISHABLE=/^sb_publishable_[A-Za-z0-9_-]+$/;
function send(res,status,payload){
 res.statusCode=status;
 for(const [key,val] of Object.entries({
  'cache-control':'no-store, max-age=0','pragma':'no-cache',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-type':'application/json; charset=utf-8'
 }))res.setHeader(key,val);
 return res.end(JSON.stringify(payload));
}
function previewConfig(req,env){
 const host=String(req.headers?.host||'').toLowerCase().split(':')[0];
 const ref=env.V4_PREVIEW_SUPABASE_PROJECT_REF||'';
 const url=env.V4_PREVIEW_SUPABASE_URL||'';
 const publishable=env.V4_PREVIEW_SUPABASE_PUBLISHABLE_KEY||'';
 const serviceKey=env.V5_ADMIN_SERVICE_ROLE_KEY||'';
 const allowlist=(env.V5_ADMIN_OPERATOR_UIDS||'').split(',').map(x=>x.trim().toLowerCase())
   .filter(x=>UUID.test(x));
 if(env.VERCEL_ENV!=='preview'||env.V5_ADMIN_PREVIEW_ENABLED!=='true'||
    !/^[a-z]{20}$/.test(ref)||ref===PRODUCTION_REF||
    url!=='https://'+ref+'.supabase.co'||!PUBLISHABLE.test(publishable)||
    !serviceKey||host!==String(env.VERCEL_URL||'').toLowerCase()||
    !host.endsWith('.vercel.app')||!allowlist.length)return null;
 return {url,publishable,serviceKey,allowlist};
}
async function jsonFetch(fetchImpl,url,{method='GET',headers={},body}={}){
 const response=await fetchImpl(url,{
  method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
  redirect:'error',signal:AbortSignal.timeout(10000)
 });
 const data=await response.json().catch(()=>null);
 return {ok:response.ok,status:response.status,data};
}
function isSafeReason(reason){
 return typeof reason==='string'&&reason.trim().length>=10&&reason.trim().length<=500;
}
async function authorizedCaller(req,cfg,fetchImpl){
 const value=String(req.headers?.authorization||'');
 const jwt=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(value)?.[1];
 if(!jwt||jwt.length>8192)return null;
 const answer=await jsonFetch(fetchImpl,cfg.url+'/auth/v1/user',{
  headers:{apikey:cfg.publishable,authorization:'Bearer '+jwt}
 });
 const user=answer.ok?answer.data:null;
 if(!user?.id||!UUID.test(user.id)||user.is_anonymous===true)return null;
 return {id:user.id,approved:cfg.allowlist.includes(user.id.toLowerCase())};
}
async function privilegedRpc(fetchImpl,cfg,name,payload){
 const response=await jsonFetch(fetchImpl,cfg.url+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:cfg.serviceKey,authorization:'Bearer '+cfg.serviceKey,
    'content-type':'application/json','accept':'application/json'},
  body:payload
 });
 if(!response.ok)throw Error('operator_database_unavailable');
 return response.data;
}
function decodeBody(body){
 if(body&&typeof body==='object'&&!Array.isArray(body))return body;
 if(typeof body==='string'&&body.length<=16000){
  try{
   const parsed=JSON.parse(body);
   return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }catch{return null}
 }
 return null;
}
async function handle(req,res,{env=process.env,fetchImpl=fetch}={}){
 const cfg=previewConfig(req,env);
 if(!cfg)return send(res,404,{error:'not_available'});
 if(req.method!=='GET'&&req.method!=='POST')
  return send(res,405,{error:'method_not_allowed'});
 const ct=String(req.headers?.['content-type']||'').toLowerCase();
 if(req.method==='POST'){
  if(!ct.startsWith('application/json'))return send(res,415,{error:'json_required'});
  const origin=String(req.headers?.origin||'');
  const host=String(req.headers?.host||'').toLowerCase();
  if(origin!=='https://'+host)return send(res,403,{error:'origin_denied'});
  if(Number(req.headers?.['content-length']||0)>16000)
   return send(res,413,{error:'payload_too_large'});
 }
 let caller;
 try{caller=await authorizedCaller(req,cfg,fetchImpl)}
 catch{return send(res,503,{error:'identity_service_unavailable'})}
 if(!caller)return send(res,401,{error:'unauthorized'});
 if(!caller.approved)return send(res,403,{error:'operator_denied'});
 if(req.method==='GET'){
  try{
   const data=await privilegedRpc(fetchImpl,cfg,'v5_admin_snapshot',{});
   return send(res,200,{workspaces:Array.isArray(data)?data:[]});
  }catch{return send(res,503,{error:'operator_database_unavailable'})}
 }
 const input=decodeBody(req.body);
 if(!input)return send(res,400,{error:'invalid_body'});
 const id=input.workspace_id;
 if(!UUID.test(String(id||''))||!isSafeReason(input.reason))
  return send(res,400,{error:'invalid_workspace_or_reason'});
 let rpcName,args,phrase,legacyPhrase=null;
 if(input.action==='grant'){
  if(!['free','pro','team'].includes(input.plan)||
    !Number.isSafeInteger(input.extra_students)||input.extra_students<0||
    input.extra_students>100000)
    return send(res,400,{error:'invalid_entitlement'});
  // Accept older operator confirmation text during the Pro -> Plus display transition.
   phrase='SET '+(input.plan==='pro'?'PLUS':input.plan.toUpperCase())+' '+id.slice(0,8);
   if(input.plan==='pro')legacyPhrase='SET PRO '+id.slice(0,8);
  rpcName='v5_admin_apply_plan';
  args={p_workspace_id:id,p_plan:input.plan,
    p_extra_students:input.extra_students,p_operator_label:caller.id,
    p_reason:input.reason.trim()};
 }else if(input.action==='release_qa'){
  if(!Number.isSafeInteger(input.expected_count)||input.expected_count<1)
   return send(res,400,{error:'invalid_expected_count'});
  phrase='RELEASE QA '+input.expected_count+' '+id.slice(0,8);
  rpcName='v5_admin_release_qa_seats';
  args={p_workspace_id:id,p_expected_count:input.expected_count,
    p_operator_user_id:caller.id,p_reason:input.reason.trim()};
 }else return send(res,400,{error:'invalid_action'});
 if(input.confirm!==phrase&&input.confirm!==legacyPhrase)
   return send(res,400,{error:'confirmation_mismatch'});
 try{
  const data=await privilegedRpc(fetchImpl,cfg,rpcName,args);
  return send(res,200,{ok:true,...(rpcName==='v5_admin_release_qa_seats'?
    {released:Number(data||0)}:{})});
 }catch{return send(res,409,{error:'operator_action_not_applied_check_state'})}
}
module.exports=async function v5Admin(req,res){return handle(req,res)};
module.exports._test={handle,previewConfig};
