/* 好好上課 V4.0 — optional invitation UI. The V4 RPCs must be installed on a
 * separate staging Supabase before writes are enabled; V3.5.9 stays unchanged.
 * A browser role switch never confers authorization: every operation checks auth.uid() server-side.
 */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const allowedStatuses={pending_teacher:"等老師確認",pending_parent:"等家長確認",approved:"已連結",declined:"未通過",cancelled:"已撤回",expired:"已過期",disconnected:"已解除"};
const safeUrl=token=>{const url=new URL(location.origin+location.pathname);url.searchParams.set("v4invite",token);return url.toString()};
const currentToken=()=>new URLSearchParams(location.search).get("v4invite")||"";
export function invitationToken(value,origin){
 const raw=String(value||'').trim();
 if(/^[a-f0-9]{64}$/.test(raw))return raw;
 let url;try{url=new URL(raw);}catch{throw Error('請貼上完整邀請連結或邀請碼');}
 if(url.origin!==origin||url.username||url.password)throw Error('請使用好好上課的邀請連結');
 const token=url.searchParams.get('v4invite')||'';
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('邀請碼格式不正確，請對方重新分享');
 return token;
}
const guid=/^[a-f0-9-]{36}$/i;
export function createV4Connections({getClient,getUser,getRole,getStudents,getLinks,getProfiles=()=>[],onChanged,notify}){
 const $=id=>document.getElementById(id);
 let stream=null,scanTurn=0,epoch=0;
 let inbox=[],enabled=false,loading=false,preview=null,token="",shareUrl="",seq=0,errorText="";
 const sessionKey=()=>getUser()?.id||"";
 const myStudents=()=>getStudents().filter(s=>s.teacher_id===sessionKey());
 const studentOptions=()=>myStudents().map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name||"學生")+'</option>').join("");
 const rpc=async(name,args={})=>{
   const client=getClient();
   if(!client||!sessionKey())throw Error("請先登入 Google 帳號");
   const owner=sessionKey(),generation=epoch;
   const {data,error}=await client.rpc(name,args);
   if(owner!==sessionKey()||generation!==epoch)throw Error('登入帳號已變更，請重新操作');
   if(error)throw Error(error.message||"伺服器暫時無法處理");
   return data;
 };
 function stopScan(){
   ++scanTurn;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
 }
 function clear(){
   stopScan();++epoch;++seq;inbox=[];enabled=false;loading=false;preview=null;token="";shareUrl="";errorText="";
   const root=$("v4-connection-content");if(root)root.innerHTML="";
   const share=$("v4-share-result");if(share)share.innerHTML="";
 }
 function display(){
   stopScan();
   const card=$("v4-connection-card"),root=$("v4-connection-content"),share=$("v4-share-result");
   if(!card||!root)return;
   const role=getRole(),user=getUser(),relevant=!!user&&["parent","teacher"].includes(role);
   card.classList.toggle("hidden",!relevant);
   if(!relevant){stopScan();return;}
   if($("v4-connections-title"))$("v4-connections-title").textContent=role==="parent"?"我的孩子與老師":"課程連結與邀請";
   if(!enabled){
     root.innerHTML='<p class="section-sub">'+(loading?"正在讀取連結申請…":
       esc(errorText||'V4 邀請功能尚待隔離測試環境設定，請稍後再試。'))+'</p>';
     if(share)share.innerHTML="";
     return;
   }
   const pending=inbox.filter(r=>r.role===role&&["pending_teacher","pending_parent"].includes(r.status));
   const others=inbox.filter(r=>r.role===role&&!pending.includes(r)).slice(0,8);
   const linked=getLinks().filter(g=>role==="parent"?g.guardian_id===sessionKey():g.teacher_id===sessionKey());
   const profileName=(id,fallback)=>getProfiles().find(p=>p.id===id)?.display_name?.trim()||fallback;
   const linkList=linked.length?'<div class="v4-linked"><h3>已連結的課程</h3>'+linked.map(g=>{
     const student=getStudents().find(s=>s.id===g.student_id);
     return '<div class="v4-request-row"><strong>'+esc(student?.name||"學生")+'</strong><div class="v4-actions">'+
       '<small>老師：'+esc(profileName(g.teacher_id,g.teacher_id===sessionKey()?"目前帳號":"已連結老師"))+' · 家長：'+esc(profileName(g.guardian_id,g.guardian_id===sessionKey()?"目前帳號":"已連結家長"))+'</small>'+
       '<button class="secondary-button" type="button" data-v4-action="unlink" data-id="'+esc(g.id)+'">解除這筆連結</button></div></div>';
   }).join("")+'</div>':"";
   const parentForm=role==="parent"?'<form id="v4-parent-request-form" class="v4-form">'+
     '<label>老師的 Google Email<input name="email" type="email" maxlength="254" placeholder="teacher@example.com" required></label>'+
     '<label>孩子怎麼稱呼？<input name="child" maxlength="80" placeholder="例如：小明" required></label>'+
     '<button class="primary-button" type="submit">送出連結申請</button></form>':'';
   const teacherForm=role==="teacher"?
     '<label>要連結的學生<select id="v4-link-student">'+studentOptions()+'</select></label>':'';
   const pendingList=pending.length?pending.map(r=>{
     const actionable=(r.role==="teacher"&&r.status==="pending_teacher")||
                      (r.role==="parent"&&r.status==="pending_parent");
     const studentSelect=actionable&&r.role==="teacher"?
       '<label>確認連結哪一位學生<select data-v4-student="'+esc(r.id)+'">'+
       (r.student_id?myStudents().filter(s=>s.id===r.student_id):myStudents()).map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join("")+
       '</select></label>':'';
     return '<div class="v4-request-row"><strong>'+esc(r.other_name||"一位使用者")+'</strong>'+
       '<small>'+esc(allowedStatuses[r.status]||r.status)+'</small>'+
       (r.role==="teacher"&&r.child_label?'<p>對方填寫的孩子稱呼：'+esc(r.child_label)+'</p>':'')+
       studentSelect+
       '<div class="v4-actions">'+(actionable?'<button class="primary-button" type="button" data-v4-action="approve" data-id="'+esc(r.id)+'">確認連結</button>'+
         '<button class="secondary-button" type="button" data-v4-action="decline" data-id="'+esc(r.id)+'">婉拒</button>':
         '<button class="secondary-button" type="button" data-v4-action="cancel" data-id="'+esc(r.id)+'">撤回申請</button>')+
       '</div></div>';
   }).join(""):'<p class="section-sub">目前沒有需要處理的連結申請。</p>';
   const history=others.length?'<details class="v4-history"><summary>查看近期連結紀錄</summary>'+
     others.map(r=>'<p>'+esc(r.other_name||"一位使用者")+' · '+esc(allowedStatuses[r.status]||r.status)+'</p>').join("")+
     '</details>':'';
   root.innerHTML=(errorText?'<p class="v4-error" role="alert">'+esc(errorText)+'</p>':'')+
     '<div class="v4-columns"><div><h3>'+(role==="parent"?"申請連結老師":"分享學生連結")+'</h3>'+
     (role==="parent"?'<p class="section-sub">可以輸入老師 Email，或請老師掃描你的邀請碼。</p>':
       '<p class="section-sub">可以產生邀請碼，讓家長掃描後送出申請。</p>')+
     parentForm+teacherForm+
     '<div class="v4-actions"><button class="secondary-button" type="button" data-v4-action="qr">產生 QR Code</button>'+
     '<button class="secondary-button" type="button" data-v4-action="share">取得分享連結</button></div>'+
     '<div class="v4-actions"><button class="secondary-button" type="button" data-v4-action="scan">掃描 QR Code</button></div>'+
     '<p class="section-sub">也可以用手機相機掃碼，或在下方貼上邀請連結。</p>'+
     '<label>邀請連結或邀請碼<input id="v4-manual-link" autocomplete="off" spellcheck="false"></label>'+
     '<button class="secondary-button" type="button" data-v4-action="open-link">開啟邀請</button>'+
     '<div id="v4-scan-area" aria-live="polite"></div>'+
     linkList+'</div><div><h3>連結申請</h3>' +pendingList+history+'</div></div>'+
     (preview?'<div class="v4-link-preview"><strong>有人分享了邀請連結</strong><p>來自：'+esc(preview.name||"一位使用者")+
       '。請先確認對方身分，送出後還要經過對方同意。</p>'+
       (preview.side==="teacher"?'<label>孩子的稱呼<input id="v4-claim-child" maxlength="80" placeholder="例如：小明"></label>':
        '<label>選擇要連結的學生<select id="v4-claim-student">'+studentOptions()+'</select></label>')+
       '<div class="v4-actions"><button class="primary-button" type="button" data-v4-action="claim">送出連結申請</button>'+
       '<button class="secondary-button" type="button" data-v4-action="dismiss">稍後再說</button></div></div>':'');
   if(share&&shareUrl){
     share.innerHTML='<p>連結已建立，請傳給要邀請的人。邀請碼有期限，收到的人仍需要登入並確認。</p>'+
       '<label>可分享的連結<input readonly value="'+esc(shareUrl)+'" aria-label="可分享的連結"></label>'+
       '<div class="v4-actions"><button class="secondary-button" type="button" data-v4-action="copy">複製連結</button>'+
       '<button class="secondary-button" type="button" data-v4-action="native-share">分享</button>'+
       '<a href="'+esc(shareUrl)+'" target="_blank" rel="noopener noreferrer">開啟連結</a></div><div id="v4-qr-output" aria-label="邀請 QR Code"></div>';
     const qr=$("v4-qr-output");
     if(qr&&typeof window.QRCode==="function"){
       new window.QRCode(qr,{text:shareUrl,width:180,height:180,correctLevel:window.QRCode.CorrectLevel.M});
     }else if(qr){
       qr.textContent="此瀏覽器未能載入 QR Code 元件，可先使用「複製連結」。";
     }
   }else if(share)share.innerHTML="";
 }
 async function refresh(){
   const user=sessionKey(),turn=++seq;
   if(!user){clear();return;}
   loading=true;display();
   try{
     const data=await rpc("v4_connection_inbox");
     if(turn!==seq||sessionKey()!==user)return;
     inbox=Array.isArray(data)?data:[];enabled=true;errorText="";
     const incoming=currentToken();
     if(incoming&&incoming!==token){
       token=incoming;
       try{
         const candidate=invitationToken(incoming,location.origin);
         const result=await rpc("v4_preview_connection_link",{p_token:candidate});
         if(turn!==seq||sessionKey()!==user)return;
         preview=result;
         if(!preview)errorText="這個邀請連結可能已使用或過期。請對方重新分享，或貼上新的邀請連結。";
       }catch(e){preview=null;errorText=e.message;}

     }
   }catch(e){
     if(turn!==seq||sessionKey()!==user)return;
     enabled=false;errorText=e.message;
   }finally{if(turn===seq&&sessionKey()===user){loading=false;display();}}
 }
 async function perform(fn){
   if(!enabled||loading)return;
   const owner=sessionKey(),generation=epoch;
   stopScan();loading=true;errorText="";display();
   try{await fn();if(owner!==sessionKey()||generation!==epoch)return;await refresh();}
   catch(e){if(owner!==sessionKey()||generation!==epoch)return;errorText=e.message;loading=false;display();notify(errorText);}
 }
 async function handleClick(el){
   const action=el?.closest?.("[data-v4-action]");
   if(!action)return false;
   const kind=action.dataset.v4Action,id=action.dataset.id;
   if(kind==='stop-scan'){stopScan();display();return true;}
   if(kind==='scan'){
     stopScan();
     const area=$('v4-scan-area');
     if(!area)return true;
     if(!navigator.mediaDevices?.getUserMedia||typeof window.BarcodeDetector!=='function'){
       area.textContent='這個瀏覽器暫不支援網站內掃碼。請用手機相機掃描，或貼上邀請連結。';return true;
     }
     const turn=scanTurn,owner=sessionKey();
     area.innerHTML='<video id="v4-scanner-video" autoplay playsinline muted aria-label="邀請碼相機畫面"></video><button type="button" class="secondary-button" data-v4-action="stop-scan">關閉相機</button>';
     try{
       const detector=new window.BarcodeDetector({formats:['qr_code']});
       const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
       if(turn!==scanTurn||owner!==sessionKey()){media.getTracks().forEach(t=>t.stop());return true;}
       stream=media;const video=$('v4-scanner-video');video.srcObject=media;await video.play();
       const detect=async()=>{
         if(turn!==scanTurn||owner!==sessionKey())return;
         try{
           const found=await detector.detect(video);
           if(found.length){
             const value=invitationToken(found[0].rawValue,location.origin);
             stopScan();const url=new URL(location.href);url.searchParams.set('v4invite',value);
             history.replaceState(null,'',url.toString());token='';await refresh();return;
           }
           window.requestAnimationFrame(detect);
         }catch{stopScan();area.textContent='無法讀取這個 QR Code。請掃描好好上課邀請碼，或貼上邀請連結。';}
       };
       window.requestAnimationFrame(detect);
     }catch{stopScan();area.textContent='無法開啟相機。你可以改用手機相機掃描，或貼上邀請連結。';}
     return true;
   }
   if(kind==='open-link'){
     try{
       const value=invitationToken($('v4-manual-link')?.value,location.origin);
       const url=new URL(location.href);url.searchParams.set('v4invite',value);
       history.replaceState(null,'',url.toString());token='';await refresh();
     }catch(e){errorText=e.message;display();notify(errorText);}
     return true;
   }
   if(kind==='native-share'){
     if(shareUrl&&navigator.share)try{await navigator.share({title:'好好上課邀請',url:shareUrl});}catch{}
     else notify('請複製下方連結，再傳給對方');
     return true;
   }
   if(kind==="dismiss"){
     preview=null;token="";const u=new URL(location.href);u.searchParams.delete("v4invite");history.replaceState(null,"",u.toString());display();return true;
   }
   if(kind==="copy"){
     if(shareUrl)try{await navigator.clipboard.writeText(shareUrl);notify("邀請連結已複製");}
     catch{notify("無法自動複製，請用瀏覽器的分享功能");}
     return true;
   }
   if(kind==="qr"||kind==="share"){
     const side=getRole();
     const student=side==="teacher"?$("v4-link-student")?.value:null;
     await perform(async()=>{
       if(side==="teacher"&&!guid.test(student||""))throw Error("請先建立並選擇學生");
       const newToken=await rpc("v4_create_connection_link",{
          p_side:side,p_student_id:student||null,p_share:kind==="share"});
       shareUrl=safeUrl(newToken);
       notify("邀請連結已建立");
     });return true;
   }
   if(kind==="claim"){
     const child=preview?.side==="teacher"?$("v4-claim-child")?.value?.trim()||"":"";
     const student=preview?.side==="parent"?$("v4-claim-student")?.value:null;
     await perform(async()=>{
       if(!preview||!token)throw Error("請先開啟有效邀請連結");
       if(preview.side==="teacher"&&!child)throw Error("請填寫孩子的稱呼");
       if(preview.side==="parent"&&!student)throw Error("請先選擇學生");
       await rpc("v4_claim_connection_link",{p_token:token,p_child_label:child,p_student_id:student||null});
       token="";preview=null;
       const u=new URL(location.href);u.searchParams.delete("v4invite");history.replaceState(null,"",u.toString());
       notify("已送出申請，等待對方確認");
     });return true;
   }
   if(kind==="unlink"){
     const link=getLinks().find(g=>g.id===id);
     const student=getStudents().find(s=>s.id===link?.student_id);
     const profileName=(id,fallback)=>getProfiles().find(p=>p.id===id)?.display_name?.trim()||fallback;
     const confirm=typeof window!=="undefined"&&window.__tutorSiteConfirm;
     if(typeof confirm!=="function"){notify("確認視窗尚未載入，為保護資料本次未解除連結");return true;}
     const done=await confirm({
       title:"確認解除課程連結",
       description:"解除後，這段關係將停止查看指定學生的課程與付款資料。",
       details:[
         "學生："+(student?.name||"未命名學生"),
         "老師："+profileName(link?.teacher_id,link?.teacher_id===sessionKey()?"目前帳號":"已連結老師"),
         "家長："+profileName(link?.guardian_id,link?.guardian_id===sessionKey()?"目前帳號":"已連結家長"),
         "已完成課程、付款與稽核紀錄仍會保留，不會被刪除。"
       ],
       confirmLabel:"確認解除",
       cancelLabel:"保留連結",
       busyLabel:"正在解除…",
       action:async()=>{
         if(!enabled||loading)throw Error("資料仍在同步，請稍後再試");
         const owner=sessionKey(),generation=epoch;
         loading=true;errorText="";display();
         try{
           await rpc("v4_disconnect_guardian",{p_student_guardian_id:id});
           try{await onChanged();await refresh();}catch(refreshError){console.warn("解除連結後重新整理失敗",refreshError);}
         }catch(error){
           errorText=error.message||"解除連結失敗，原有關係仍保留。";
           display();
           throw Error(errorText);
         }finally{
           if(owner===sessionKey()&&generation===epoch){loading=false;display();}
         }
       }
     });
     if(done)notify("已解除連結");
     return true;
   }
   if(["approve","decline","cancel"].includes(kind)){
     const student=$("v4-connection-content")?.querySelector('[data-v4-student="'+id+'"]')?.value||null;
     await perform(async()=>{
       if(kind==="cancel")await rpc("v4_cancel_connection_request",{p_request_id:id});
       else{
         if(kind==="approve"&&getRole()==="teacher"&&!student)throw Error("請先選擇學生");
         await rpc("v4_decide_connection_request",{p_request_id:id,p_approve:kind==="approve",p_student_id:student});
         if(kind==="approve")await onChanged();
       }
       notify(kind==="approve"?"已完成連結":kind==="decline"?"已婉拒申請":"已撤回申請");
     });return true;
   }
   return true;
 }
 async function handleSubmit(ev){
   if(ev.target?.id!=="v4-parent-request-form")return false;
   ev.preventDefault();
   const fields=new FormData(ev.target);
   await perform(async()=>{
     await rpc("v4_request_teacher",{p_teacher_email:String(fields.get("email")||"").trim(),
       p_child_label:String(fields.get("child")||"").trim()});
     notify("已送出申請。如果老師已使用好好上課，就會收到提醒。");
   });
   return true;
 }
 return {render:display,refresh,clear,handleClick,handleSubmit};
}
