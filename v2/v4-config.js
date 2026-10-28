/* Runtime-only public configuration loader.
 * Production settings must be Vercel Production environment variables and are
 * released only by /api/v4-config on the exact production hostname.
 * Never place service_role, database passwords, or GAS secrets here.
 */
(function initV4Config(global){
  const PRODUCTION_HOST="tutor.rapid4grad.com";
  const PRODUCTION_REF="vctisuglfoxyuwlvyjee";
  const localHost=host=>["localhost","127.0.0.1"].includes(host);
  const validKey=key=>/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||"");
  const validLocalKey=key=>validKey(key)||/^eyJ[A-Za-z0-9._-]+$/.test(key||"");
  const validLocal=(config,location)=>location.protocol==="http:"&&localHost(location.hostname)&&
    config?.environment==="local"&&config?.isolated===true&&config?.projectRef==="local"&&
    /^http:\/\/(?:localhost|127\.0\.0\.1):54321$/.test(config?.url||"")&&validLocalKey(config?.publishableKey);
  const validRemote=(config,location)=>{
    if(location.protocol!=="https:"||!validKey(config?.publishableKey))return false;
    if(location.hostname===PRODUCTION_HOST)return config?.environment==="production"&&config?.isolated===false&&
      config?.projectRef===PRODUCTION_REF&&config?.url===`https://${PRODUCTION_REF}.supabase.co`;
    return location.hostname.endsWith(".vercel.app")&&config?.environment==="preview"&&config?.isolated===true&&
      /^[a-z]{20}$/.test(config?.projectRef||"")&&config.projectRef!==PRODUCTION_REF&&
      config?.url===`https://${config.projectRef}.supabase.co`;
  };

  global.V4_BACKEND=null;
  global.V4_CONFIG_ERROR="此環境尚未設定可用的好好上課資料庫，已停止登入。";
  global.V4_CONFIG_READY=(async()=>{
    const location=global.location||{};
    let config=null;
    if(localHost(location.hostname||"")){
      config=global.V4_LOCAL_BACKEND||null;
      if(!validLocal(config,location))throw Error("本機測試資料庫設定無效；只允許 localhost Supabase。");
    }else if(location.hostname===PRODUCTION_HOST&&location.protocol==="https:"){
      const response=await global.fetch("/api/v4-config",{method:"GET",credentials:"omit",cache:"no-store",redirect:"error"});
      if(!response.ok)throw Error("正式登入設定尚未就緒；目前沒有連線到其他資料庫。");
      config=await response.json();
      if(!validRemote(config,location))throw Error("正式資料庫設定未通過網域與專案核對，已停止登入。");
    }else if(location.protocol==="https:"&&(location.hostname||"").endsWith(".vercel.app")){
      let response;
      try{
        response=await global.fetch("/api/v4-config",{method:"GET",credentials:"omit",cache:"no-store",redirect:"error"});
      }catch{
        throw Error("Preview 尚未連接隔離測試資料庫，登入功能暫不可用。");
      }
      if(!response.ok)throw Error("Preview 尚未連接隔離測試資料庫，登入功能暫不可用。");
      config=await response.json();
      if(!validRemote(config,location))throw Error("Preview 資料庫未通過隔離檢查，已停止登入。");
    }else{
      throw Error("此網站網域不允許連接好好上課資料庫。");
    }
    global.V4_BACKEND=config;
    global.V4_CONFIG_ERROR="";
    return config;
  })().catch(error=>{
    global.V4_BACKEND=null;
    global.V4_CONFIG_ERROR=String(error?.message||"環境設定無效，已停止登入。");
    return null;
  });
})(window);
