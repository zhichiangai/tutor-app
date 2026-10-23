// V4 GAS bridge — deploy only after staging security review.
// Keep keys in Supabase secrets and GAS Script Properties, never browser code.
const endpoint=Deno.env.get("SUPABASE_URL");
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const bridgeSecret=Deno.env.get("V4_GAS_BRIDGE_SECRET");
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
async function callRpc(name:string,params:Record<string,unknown>){
  const rsp=await fetch(endpoint+"/rest/v1/rpc/"+name,{
    method:"POST",
    headers:{"Content-Type":"application/json","apikey":serviceKey!,
      "Authorization":"Bearer "+serviceKey},
    body:JSON.stringify(params)
  });
  const content=await rsp.json().catch(()=>({message:"RPC response was not JSON"}));
  if(!rsp.ok)throw Error("RPC "+name+" failed: "+rsp.status+" "+JSON.stringify(content).slice(0,200));
  return content;
}
Deno.serve(async request=>{
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(!endpoint||!serviceKey||!bridgeSecret)return json({error:"Bridge not configured"},503);
  const supplied=request.headers.get("x-v4-mail-key");
  if(!supplied||supplied!==bridgeSecret)return json({error:"Unauthorized"},401);
  try{
    const args=await request.json();
    if(args?.action==="claim"){
      const limit=Math.max(1,Math.min(10,Number(args.limit)||5));
      const data=await callRpc("v4_mail_claim",{p_limit:limit});
      return json({messages:data||[]});
    }
    if(args?.action==="ack"){
      if(typeof args.id!=="string"||!/^[0-9a-f-]{36}$/i.test(args.id)||
        typeof args.ok!=="boolean")return json({error:"Invalid ACK"},400);
      await callRpc("v4_mail_ack",{p_id:args.id,p_ok:args.ok,p_error:String(args.error||"").slice(0,500)});
      return json({acknowledged:true});
    }
    return json({error:"Unknown action"},400);
  }catch(err){
    console.error("V4 mail bridge error",String(err).slice(0,250));
    return json({error:"Mail bridge temporarily unavailable"},503);
  }
});
