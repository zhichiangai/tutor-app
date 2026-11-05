// V5.2 Team projects and invitations. PostgreSQL RLS/RPC is authoritative.
// This module never grants V4 lesson or payment access to teammates.
export function createV5TeamUI({getClient,getUser,getRole,isReady,getOwnWorkspace,notify}){
 let generation=0,identity='',loading=false,ready=false,error='',data=null,writing=false;
 let selectedManagedWorkspace='';
 const $=id=>document.getElementById(id);
 const text=(element,value)=>{element.textContent=String(value??'');return element};
 const node=(tag,className,value)=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(value!==undefined)el.textContent=String(value);
  return el;
 };
 function clear(){
  generation++;identity='';loading=false;ready=false;error='';data=null;writing=false;selectedManagedWorkspace='';
  $('v5-team-card')?.classList.add('hidden');
  for(const id of ['v5-team-invite-list','v5-team-project-list',
   'v5-team-members-list','v5-team-assignments','v5-team-message',
   'v5-team-transfer-list']){
   $(id)?.replaceChildren();
  }
 }
 const valid=()=>isReady()&&getUser()?.id&&getRole()==='teacher';
 function render(){
  const card=$('v5-team-card');
  if(!card)return;
  if(!valid()){card.classList.add('hidden');return}
  if(!ready&&!loading){card.classList.add('hidden');return}
  const current=data||{plan:null,managed:[],projects:[],invites:[],
   members:[],assignments:[],transfers:[]};
  const managed=current.managed||[];
  const chosen=managed.find(t=>t.workspace_id===selectedManagedWorkspace)||managed[0]||null;
  const ws=chosen?{id:chosen.workspace_id}:null;
  const isOwner=Boolean(chosen?.manager_user_id===getUser()?.id);
  if(ws)selectedManagedWorkspace=ws.id;
  const incoming=current.invites.filter(i=>i.status==='pending'&&
    i.recipient_email===String(getUser()?.email||'').toLowerCase());
  const assigned=current.projects.filter(p=>current.assignments.some(a=>
    a.project_id===p.id&&a.user_id===getUser()?.id));
  const memberOfTeam=current.members.some(m=>m.user_id===getUser()?.id&&
    m.workspace_id!==ws?.id);
  const hasIncomingTransfer=(current.transfers||[]).some(t=>
    t.to_user_id===getUser()?.id&&t.status==='pending');
  const show=loading||!!error||isOwner||incoming.length>0||
    assigned.length>0||memberOfTeam||hasIncomingTransfer;
  card.classList.toggle('hidden',!show);
  if(!show)return;
  const msg=$('v5-team-message');
  msg.textContent=loading?'正在確認 Team 權限與專案資料…':error||
    (isOwner?'你可以管理自己的 Team 專案及邀請。':
    '你只能開啟被指派的專案；加入團隊不會自動開放學費與課程資料。');
  const controls=$('v5-team-owner-controls');
  controls?.classList.toggle('hidden',!isOwner);
  const managedSelect=$('v5-team-manage-select');
  managedSelect.replaceChildren();
  for(const team of managed){
   const opt=node('option','','Team · '+team.workspace_id.slice(-8));
   opt.value=team.workspace_id;managedSelect.append(opt);
  }
  if(ws)managedSelect.value=ws.id;
  const ownProjects=current.projects.filter(p=>p.workspace_id===ws?.id);
  const visibleProjects=isOwner?ownProjects:assigned;
  const projectList=$('v5-team-project-list');
  projectList.replaceChildren();
  if(!visibleProjects.length)projectList.append(node('p','section-sub','目前沒有可查看的 Team 專案。'));
  for(const p of visibleProjects){
   const wrap=node('div','v5-team-row');
   const title=node('strong','',p.name+(p.status==='archived'?' · 已封存':''));
   wrap.append(title);
   if(isOwner&&p.status==='active'){
    const button=node('button','secondary-button','封存');
    button.type='button';button.dataset.v5TeamAction='archive';
    button.dataset.id=p.id;wrap.append(button);
   }
   projectList.append(wrap);
  }
  const invites=$('v5-team-invite-list');invites.replaceChildren();
  const displayInvites=isOwner?current.invites.filter(i=>i.workspace_id===ws.id):incoming;
  if(!displayInvites.length)invites.append(node('p','section-sub','目前沒有待處理邀請。'));
  for(const invite of displayInvites){
   const wrap=node('div','v5-team-row');
   wrap.append(node('span','',isOwner?
    invite.recipient_email+' · '+invite.status:
    '收到 Team 老師邀請'));
   if(invite.status==='pending'){
    for(const [kind,label] of isOwner?
      [['cancel-invite','取消邀請']]:
      [['accept-invite','接受'],['decline-invite','婉拒']]){
     const button=node('button','secondary-button',label);
     button.type='button';button.dataset.v5TeamAction=kind;
     button.dataset.id=invite.id;wrap.append(button);
    }
   }
   invites.append(wrap);
  }
  // A teacher can leave without an owner action. This does not touch their
  // personal workspace or delete any Team project/history.
  if(!isOwner){
   for(const membership of current.members.filter(m=>
    m.user_id===getUser()?.id&&m.workspace_id!==ws?.id)){
    const row=node('div','v5-team-row');
    row.append(node('span','','已加入 Team（末碼 '+membership.workspace_id.slice(-6)+'）'));
    const leave=node('button','secondary-button','退出 Team');
    leave.type='button';leave.dataset.v5TeamAction='leave-team';
    leave.dataset.id=membership.workspace_id;
    row.append(leave);invites.append(row);
   }
  }
  const members=$('v5-team-members-list');members.replaceChildren();
  const ownMembers=current.members.filter(m=>m.workspace_id===ws?.id&&
    m.user_id!==getUser()?.id);
  if(isOwner){
   if(!ownMembers.length)members.append(node('p','section-sub','尚無其他老師加入。'));
   for(const m of ownMembers){
    const row=node('div','v5-team-row');
    row.append(node('span','','老師（帳號末碼 '+m.user_id.slice(-6)+'）'));
    const button=node('button','secondary-button','移除老師');
    button.type='button';button.dataset.v5TeamAction='remove-teacher';
    button.dataset.id=m.user_id;row.append(button);
    members.append(row);
   }
  }
  const projectSelect=$('v5-team-project-select'),
   teacherSelect=$('v5-team-teacher-select');
  projectSelect.replaceChildren();teacherSelect.replaceChildren();
  for(const p of ownProjects.filter(p=>p.status==='active')){
   const option=node('option','',p.name);option.value=p.id;projectSelect.append(option);
  }
  for(const m of ownMembers){
   const option=node('option','','老師（末碼 '+m.user_id.slice(-6)+'）');
   option.value=m.user_id;teacherSelect.append(option);
  }
  $('v5-team-assign-submit').disabled=writing||
    !projectSelect.options.length||!teacherSelect.options.length;
  const successorSelect=$('v5-team-successor-select');
  successorSelect.replaceChildren();
  for(const m of ownMembers){
   const opt=node('option','','老師（末碼 '+m.user_id.slice(-6)+'）');
   opt.value=m.user_id;successorSelect.append(opt);
  }
  const pendingForTeam=(current.transfers||[]).some(t=>
   t.workspace_id===ws?.id&&t.status==='pending');
  $('v5-team-transfer-submit').disabled=writing||
   !successorSelect.options.length||pendingForTeam;
  const assignedList=$('v5-team-assignments');assignedList.replaceChildren();
  if(isOwner){
   const byId=new Map(ownProjects.map(p=>[p.id,p.name]));
   for(const m of current.assignments.filter(a=>a.workspace_id===ws.id)){
    const row=node('div','v5-team-row');
    row.append(node('span','',(byId.get(m.project_id)||'專案')+
      ' · 老師末碼 '+m.user_id.slice(-6)));
    const button=node('button','secondary-button','取消指派');
    button.type='button';button.dataset.v5TeamAction='unassign';
    button.dataset.project=m.project_id;button.dataset.id=m.user_id;
    row.append(button);assignedList.append(row);
   }
  }
  const transfers=$('v5-team-transfer-list');transfers.replaceChildren();
  const visibleTransfers=(current.transfers||[]).filter(t=>t.status==='pending'&&
   (t.to_user_id===getUser()?.id||(isOwner&&t.workspace_id===ws?.id)));
  if(!visibleTransfers.length)
   transfers.append(node('p','section-sub','目前沒有待確認的管理權轉讓。'));
  for(const transfer of visibleTransfers){
   const row=node('div','v5-team-row');
   row.append(node('span','',transfer.to_user_id===getUser()?.id?
    '收到 Team（末碼 '+transfer.workspace_id.slice(-6)+'）管理權轉讓邀請':
    '等待接任老師（末碼 '+transfer.to_user_id.slice(-6)+'）確認'));
   const actions=transfer.to_user_id===getUser()?.id?
    [['accept-transfer','接受管理權'],['decline-transfer','拒絕']]:
    [['cancel-transfer','取消轉讓']];
   for(const [action,label] of actions){
    const btn=node('button','secondary-button',label);
    btn.type='button';btn.dataset.v5TeamAction=action;
    btn.dataset.id=transfer.id;row.append(btn);
   }
   transfers.append(row);
  }
  $('v5-team-owner-controls').querySelectorAll('button[type=submit]').forEach(b=>{
   if(b.id!=='v5-team-assign-submit')b.disabled=writing;
  });
 }
 async function refresh(){
  if(!valid()){clear();return}
  const id=getUser().id,stamp=++generation;
  identity=id;loading=true;error='';render();
  const client=getClient();
  if(!client){error='尚未連線到授權資料庫';loading=false;render();return}
  try{
   const r=await Promise.all([
    client.rpc('v5_my_plan'),
    client.from('v5_team_projects').select('id,workspace_id,name,status,created_by').order('created_at'),
    client.from('v5_team_invitations').select('id,workspace_id,recipient_email,status').order('created_at'),
    client.from('v5_team_roster').select('workspace_id,user_id'),
    client.from('v5_team_project_members').select('project_id,workspace_id,user_id'),
    client.rpc('v5_my_managed_teams'),
    client.from('v5_team_manager_transfers')
      .select('id,workspace_id,from_user_id,to_user_id,status').order('created_at')
   ]);
   if(stamp!==generation||getUser()?.id!==id||!valid())return;
   const failure=r.find(x=>x.error);
   if(failure){
    error=/PGRST|relation.*does not exist/i.test(failure.error?.message||'')?
     'V5.2 Team 資料庫尚未啟用。':'無法取得 Team 資料，請重新進入設定頁。';
    data=null;
   }else{
    data={plan:r[0].data,projects:r[1].data||[],invites:r[2].data||[],
     members:r[3].data||[],assignments:r[4].data||[],
     managed:r[5].data||[],transfers:r[6].data||[]};
    error='';ready=true;
   }
  }catch{
   if(stamp!==generation||getUser()?.id!==id||!valid())return;
   error='無法連線 Team 資料，稍後再試。';data=null;
  }finally{
   if(stamp===generation&&getUser()?.id===id&&valid()){loading=false;render()}
  }
 }
 async function perform(fn,success){
  if(writing||!valid())return;
  writing=true;render();
  try{
   const response=await fn();
   if(response?.error)throw response.error;
   notify(success);
   await refresh();
  }catch{
   notify('Team 操作未完成，請確認權限、資料狀態及名額限制');
  }finally{writing=false;render()}
 }
 function ownerTeam(){
  const managed=(data?.managed||[]).find(t=>
   t.workspace_id===selectedManagedWorkspace)||(data?.managed||[])[0];
  return managed?.manager_user_id===getUser()?.id?{id:managed.workspace_id}:null;
 }
 async function handleSubmit(ev){
  const id=ev.target?.id;
  if(!['v5-team-project-form','v5-team-invite-form','v5-team-assign-form',
   'v5-team-transfer-form'].includes(id))
   return false;
  ev.preventDefault();
  const ws=ownerTeam(),client=getClient();
  if(!ws||!client)return true;
  if(id==='v5-team-project-form'){
   const name=$('v5-team-project-name').value.trim();
   if(!name||name.length>80)return true;
   await perform(()=>client.from('v5_team_projects').insert({
    workspace_id:ws.id,name,created_by:getUser().id
   }).select('id'), '已新增 Team 專案');
   $('v5-team-project-name').value='';
  }else if(id==='v5-team-invite-form'){
   const recipient_email=$('v5-team-invite-email').value.trim().toLowerCase();
   if(!recipient_email||recipient_email.length>254)return true;
   await perform(()=>client.from('v5_team_invitations').insert({
    workspace_id:ws.id,recipient_email,invited_by:getUser().id
   }).select('id'),'老師邀請已建立，對方登入後可以接受');
   $('v5-team-invite-email').value='';
  }else if(id==='v5-team-transfer-form'){
   const p_target_user_id=$('v5-team-successor-select').value;
   if(!p_target_user_id||!window.confirm(
    '確定提出管理權轉讓？只有接任老師本人接受後才會生效。'))return true;
   await perform(()=>client.rpc('v5_propose_team_manager',{
    p_workspace_id:ws.id,p_target_user_id
   }),'管理權轉讓已提出，等待接任老師確認');
  }else{
   const project_id=$('v5-team-project-select').value;
   const user_id=$('v5-team-teacher-select').value;
   if(!project_id||!user_id)return true;
   await perform(()=>client.from('v5_team_project_members').insert({
    workspace_id:ws.id,project_id,user_id
   }).select('project_id'),'已指派老師到指定專案');
  }
  return true;
 }
 async function handleClick(target){
  const button=target?.closest?.('[data-v5-team-action]');
  if(!button)return false;
  const action=button.dataset.v5TeamAction,id=button.dataset.id;
  const client=getClient(),ws=ownerTeam();
  if(!client||!valid())return true;
  const actionRpc=(name)=>()=>client.rpc(name,{p_invitation_id:id});
  switch(action){
   case 'accept-invite':
    await perform(actionRpc('v5_accept_team_invitation'),'已加入 Team，等待專案指派');break;
   case 'decline-invite':
    await perform(actionRpc('v5_decline_team_invitation'),'已婉拒 Team 邀請');break;
   case 'cancel-invite':
    if(ws)await perform(actionRpc('v5_cancel_team_invitation'),'邀請已取消');break;
   case 'archive':
    if(ws&&window.confirm('確定封存這個專案？歷史資料仍會保留。'))
     await perform(()=>client.from('v5_team_projects').update({status:'archived'})
      .eq('id',id).eq('workspace_id',ws.id),'專案已封存');break;
   case 'remove-teacher':
    if(ws&&window.confirm('確定移除此老師的 Team 存取權？所有專案指派會一併取消。'))
     await perform(()=>client.rpc('v5_remove_team_teacher',{
      p_workspace_id:ws.id,p_user_id:id
     }),'已移除老師並記錄操作');break;
   case 'leave-team':
    if(window.confirm('確定退出 Team？你的專案權限會立即失效，個人家教空間不受影響。'))
     await perform(()=>client.rpc('v5_leave_team',{
      p_workspace_id:id
     }),'已退出 Team，個人資料不受影響');break;
   case 'accept-transfer':
    if(window.confirm('接受後你將成為新的 Team 管理者，負責成員與專案管理。'))
     await perform(()=>client.rpc('v5_respond_team_manager',{
      p_transfer_id:id,p_accept:true
     }),'已接受 Team 管理權，原管理者改為普通老師');break;
   case 'decline-transfer':
    await perform(()=>client.rpc('v5_respond_team_manager',{
     p_transfer_id:id,p_accept:false
    }),'已拒絕管理權轉讓');break;
   case 'cancel-transfer':
    if(ws)await perform(()=>client.rpc('v5_cancel_team_manager',{
     p_transfer_id:id
    }),'已取消待處理管理權轉讓');break;
   case 'unassign':
    if(ws&&window.confirm('確定取消此專案的老師指派？'))
     await perform(()=>client.from('v5_team_project_members').delete()
      .eq('project_id',button.dataset.project).eq('user_id',id)
      .eq('workspace_id',ws.id),'專案指派已取消');break;
  }
  return true;
 }
 function chooseManagedWorkspace(id){
  selectedManagedWorkspace=id;
  render();
 }
 return {render,refresh,clear,handleSubmit,handleClick,chooseManagedWorkspace};
}
