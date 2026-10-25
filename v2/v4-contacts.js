/* V4 independent teacher-parent contact directory.
 * Contact permission NEVER implies student/lesson/payment permission.
 * Keep this card separate from course-specific guardian relationships.
 */
const escapeContact=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const contactStatus={pending:"等待確認",connected:"已連結",declined:"已婉拒",cancelled:"已撤回",disconnected:"已解除",expired:"已到期"};
export function createV4AccountContacts({getClient,getUser,getRole,notify}){
 const node=()=>document.getElementById("v4-account-contact-card");
 const content=()=>document.getElementById("v4-account-contact-content");
 let rows=[],enabled=false,busy=false,notice="",epoch=0,confirmDisconnect=null;
 const userId=()=>getUser()?.id||"";
 async function rpc(name,args={}){
   const before=userId(),turn=epoch;
   if(!before||!getClient())throw Error("請先登入帳號");
   const {data,error}=await getClient().rpc(name,args);
   if(before!==userId()||epoch!==turn)throw Error("帳號已切換，操作已停止");
   if(error)throw Error(error.message||"服務暫時無法處理");
   return data;
 }
 function clear(){
   epoch++;rows=[];enabled=false;busy=false;notice="";confirmDisconnect=null;
   const root=content();if(root)root.innerHTML="";
 }
 function render(){
   const card=node(),root=content();
   if(!card||!root)return;
   const role=getRole(),allowed=!!userId()&&["teacher","parent"].includes(role);
   card.classList.toggle("hidden",!allowed);
   if(!allowed)return;
   const title=role==="teacher"?"家長":"老師";
   // Contact invitations can arrive before a parent has any child or parent
   // mode configured. Show the recipient's invitations in either account mode.
   const displayed=rows;
   const contactRow=r=>{
     const name=escapeContact(r.other_name||"另一位使用者"),id=escapeContact(r.id);
     const label=escapeContact((r.kind==="outgoing"?"寄出的邀請":"聯絡人")+" · "+(contactStatus[r.status]||r.status));
     const row='<div class="v4-request-row"><div><strong>'+name+'</strong><small>'+label+
       (r.status==="connected"?" · 尚未指定學生":"")+
       (r.kind==="outgoing"&&r.expires_at?" · 到期 "+escapeContact(String(r.expires_at).slice(0,10)):"")+'</small></div><div class="v4-actions">';
     const actions=r.status==="pending"?
       (r.requested_by_me?
         '<button type="button" class="secondary-button" data-contact-action="cancel" data-id="'+id+'">撤回邀請</button>':
         '<button type="button" class="primary-button" data-contact-action="approve" data-id="'+id+'">接受連結</button>'+
         '<button type="button" class="secondary-button" data-contact-action="decline" data-id="'+id+'">婉拒</button>'):
       r.status==="connected"?
         (confirmDisconnect===r.id?
           '<div class="v4-contact-warning" role="group" aria-label="確認解除聯絡人">'+
           '<p>解除後將停止聯絡人關係。已授權的課程連結不會自動取消，請另外管理。</p>'+
           '<button type="button" class="secondary-button" data-contact-action="confirm-disconnect" data-id="'+id+'">確認解除聯絡人</button>'+
           '<button type="button" class="secondary-button" data-contact-action="keep" data-id="'+id+'">保留連結</button></div>':
           '<button type="button" class="secondary-button" data-contact-action="ask-disconnect" data-id="'+id+'">解除聯絡人</button>'):
         '';
     return row+actions+'</div></div>';
   };
   const invitations=displayed.filter(r=>r.kind==="outgoing").map(contactRow).join("");
   const connections=displayed.filter(r=>r.kind!=="outgoing").map(contactRow).join("");
   root.innerHTML=
     '<p class="section-sub">可以先跟'+title+'建立聯絡人關係，不必建立學生帳號，也不必先指定孩子。</p>'+
     '<form id="v4-account-contact-form" class="v4-form">'+
       '<label>對方的 Google Email<input name="email" type="email" maxlength="254" autocomplete="off" placeholder="example@gmail.com" required></label>'+
       '<button class="primary-button" type="submit"'+((busy||!enabled)?' disabled':'')+'>邀請'+title+'連結</button>'+
     '</form>'+
     '<p class="section-sub">聯絡人連結只代表雙方同意保持聯繫，<strong>不會自動開放任何課程、學生或帳務。</strong>待處理狀態不代表對方已有帳號；到期後可以重新邀請。</p>'+
     (role==="teacher"&&displayed.some(r=>r.my_role==="parent")?'<p class="section-sub">你也有家長身分的聯絡人。接受邀請不必切換模式；需要使用家長頁面時，可到「設定 → 角色與帳號」啟用家長模式。</p>':'')+
     (notice?'<p class="v4-error" role="status">'+escapeContact(notice)+'</p>':'')+
     '<h3>我的邀請</h3>'+(enabled?(invitations||'<p class="section-sub">目前沒有寄出的邀請。</p>'):'')+
     '<h3>我的聯絡人</h3>'+
     (enabled?(connections||'<p class="section-sub">還沒有聯絡人，可以先透過 Email 邀請。</p>'):
       '<p class="section-sub">聯絡人功能尚待本機 Supabase Migration 與測試環境啟用。</p>');
 }
 async function refresh(){
   const current=userId(),turn=++epoch;
   if(!current){clear();return;}
   try{
     const result=await rpc("v4_contact_inbox");
     if(userId()!==current||turn!==epoch)return;
     rows=Array.isArray(result)?result:[];enabled=true;notice="";
   }catch(e){
     if(userId()!==current||turn!==epoch)return;
     rows=[];enabled=false;notice=e.message;
   }
   if(turn===epoch)render();
 }
 async function perform(fn,success){
   if(!enabled||busy)return;
   const current=userId(),turn=epoch;
   busy=true;notice="";render();
   try{
     await fn();
     if(turn!==epoch||current!==userId())return;
     confirmDisconnect=null;
     await refresh();
     if(current===userId())notify(enabled?success:"操作已提交，但清單重新載入失敗，請稍後再試。");
   }catch(e){
     if(current===userId()&&turn===epoch){notice=e.message;render();notify(e.message);}
   }finally{
     if(current===userId()){busy=false;render();}
   }
 }
 async function handleSubmit(ev){
   if(ev.target?.id!=="v4-account-contact-form")return false;
   ev.preventDefault();
   const email=String(new FormData(ev.target).get("email")||"").trim();
   const role=getRole();
   if(!["teacher","parent"].includes(role))return true;
   await perform(()=>rpc("v4_contact_request",{p_email:email,p_my_role:role}),
     "邀請已記錄；待處理狀態不表示對方已有帳號。");
   return true;
 }
 async function handleClick(target){
   const el=target?.closest?.("[data-contact-action]");if(!el)return false;
   const action=el.dataset.contactAction,id=el.dataset.id;
   if(action==="ask-disconnect"){confirmDisconnect=id;render();return true;}
   if(action==="keep"){confirmDisconnect=null;render();return true;}
   const serverAction=action==="confirm-disconnect"?"disconnect":action;
   if(!["approve","decline","cancel","disconnect"].includes(serverAction))return true;
   await perform(()=>rpc("v4_contact_action",{p_id:id,p_action:serverAction}),
     serverAction==="approve"?"已連結聯絡人；尚未授予課程權限":
     serverAction==="disconnect"?"已解除聯絡人；課程與帳務資料保留":
     serverAction==="cancel"?"已撤回邀請":"已婉拒邀請");
   return true;
 }
 return {render,refresh,clear,handleClick,handleSubmit};
}
