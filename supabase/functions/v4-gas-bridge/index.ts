// V4.0.0-dev.2 staging-only bridge. Deploy with explicit gateway JWT policy;
// GAS uses a high-entropy shared secret. No browser CORS or public mail endpoint.
const endpoint=Deno.env.get("SUPABASE_URL");
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const bridgeSecret=Deno.env.get("V4_GAS_BRIDGE_SECRET");
const stagingRef=Deno.env.get("V4_STAGING_PROJECT_REF");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
 status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
async function callRpc(name:string,params:Record<string,unknown>){
 const rsp=await fetch(endpoint+"/rest/v1/rpc/"+name,{
  method:"POST",headers:{"Content-Type":"application/json","apikey":serviceKey!,
   "Authorization":"Bearer "+serviceKey},body:JSON.stringify(params)});
 if(!rsp.ok)throw Error("RPC unavailable"); // Never log recipient data or server bodies.
 return await rsp.json();
}
Deno.serve(async request=>{
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 if(!stagingRef||!/^[a-z]{20}$/.test(stagingRef)||stagingRef==="vctisuglfoxyuwlvyjee"||
    endpoint!=="https://"+stagingRef+".supabase.co"||!serviceKey||!bridgeSecret||bridgeSecret.length<32)
   return json({error:"Isolated bridge not configured"},503);
 if(request.headers.has("origin"))return json({error:"Browser access denied"},403);
 const supplied=request.headers.get("x-v4-mail-key");
 if(!supplied||supplied!==bridgeSecret)return json({error:"Unauthorized"},401);
 let args;
 try{
  const raw=await request.text();
  if(raw.length>4096)return json({error:"Request too large"},413);
  args=JSON.parse(raw);
 }catch{return json({error:"Invalid JSON"},400);}
 try{
  if(args?.action==="claim"){
   if(!Number.isInteger(args.limit)||args.limit<1||args.limit>10)
     return json({error:"Invalid limit"},400);
   const data=await callRpc("v4_mail_claim",{p_limit:args.limit});
   return json({messages:data||[]});
  }
  if(args?.action==="ack"){
   if(!uuid.test(args.id||"")||!uuid.test(args.lease||"")||typeof args.ok!=="boolean"||
      typeof args.uncertain!=="boolean"||(args.ok&&args.uncertain))return json({error:"Invalid ACK"},400);
   await callRpc("v4_mail_ack",{p_id:args.id,p_lease:args.lease,p_ok:args.ok,
     p_error:args.ok?"":args.uncertain?"delivery_uncertain":"delivery_failed",p_uncertain:args.uncertain});
   return json({acknowledged:true});
  }
  return json({error:"Unknown action"},400);
 }catch{
  console.error("V4 mail bridge RPC failed; inspect isolated worker status without logging payloads");
  return json({error:"Mail bridge temporarily unavailable"},503);
 }
});
