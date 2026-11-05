// V5.1 operator UI: public credentials only; privileged actions stay server-side.
// This intentionally works only with an isolated Preview backend.
const $=id=>document.getElementById(id);
const state={client:null,workspaces:[],selected:null,busy:false};
function showStatus(message,isError=false){
 const status=$('status');
 status.textContent=String(message);
 status.classList.toggle('alert',isError);
}
function metric(label,value){
 const box=document.createElement('div'),caption=document.createElement('span'),
  number=document.createElement('b');
 box.className='metric';caption.textContent=label;number.textContent=String(value);
 box.append(caption,number);
 return box;
}
function current(){
 return state.workspaces.find(w=>w.workspace_id===$('workspace').value)||null;
}
function updateView(){
 const w=current();state.selected=w;
 const root=$('current-plan');
 root.replaceChildren();
 if(!w){
  root.append(metric('工作空間','未選擇'));
  $('grant-phrase').textContent='';
  $('qa-phrase').textContent='';
  $('qa-submit').disabled=true;return;
 }
 root.append(
  metric('方案',String(w.plan||'—').toUpperCase()),
  metric('累計學生',String(w.student_used)+'／'+String(w.student_limit)),
  metric('老師席次',String(w.teacher_used)+'／'+String(w.teacher_limit)),
  metric('已刪除 QA 可釋放',String(w.qa_deleted_eligible))
 );
 $('plan').value=w.plan;
 $('extra').value=String(w.extra_student_seats);
 $('qa-count').value=String(w.qa_deleted_eligible);
 const phrase='SET '+String($('plan').value).toUpperCase()+' '+w.workspace_id.slice(0,8);
 $('grant-phrase').textContent=phrase;
 $('qa-phrase').textContent='RELEASE QA '+w.qa_deleted_eligible+' '+w.workspace_id.slice(0,8);
 $('qa-submit').disabled=state.busy||Number(w.qa_deleted_eligible)<1;
}
function populate(workspaces){
 const selected=$('workspace').value,select=$('workspace');
 select.replaceChildren();
 state.workspaces=Array.isArray(workspaces)?workspaces:[];
 for(const w of state.workspaces){
  const option=document.createElement('option');
  option.value=w.workspace_id;
  option.textContent=String(w.workspace_name||'未命名')+' · '+w.workspace_id.slice(0,8);
  select.append(option);
 }
 if(state.workspaces.some(w=>w.workspace_id===selected))select.value=selected;
 updateView();
}
async function getToken(){
 const {data,error}=await state.client.auth.getSession();
 if(error||!data?.session?.access_token)throw Error('請先在隔離 Preview 的好好上課登入授權帳號');
 return data.session.access_token;
}
async function request(method,payload){
 const token=await getToken();
 const response=await fetch('/api/v5-admin',{
  method,credentials:'omit',cache:'no-store',redirect:'error',
  headers:{authorization:'Bearer '+token,
   ...(payload?{'content-type':'application/json'}:{})},
  ...(payload?{body:JSON.stringify(payload)}:{})
 });
 const result=await response.json().catch(()=>null);
 if(!response.ok){
  const reason=result?.error||'操作失敗';
  if(response.status===401)throw Error('登入已過期，請重新登入');
  if(response.status===403)throw Error('沒有 V5 管理者權限');
  if(response.status===404)throw Error('管理 API 尚未在此隔離 Preview 啟用');
  if(response.status===409)throw Error('資料可能已變動，請重新整理狀態，確認是否已套用');
  throw Error(reason);
 }
 return result;
}
async function refresh(){
 if(state.busy)return;
 showStatus('正在從隔離資料庫讀取工作空間及名額…');
 try{
  const result=await request('GET');
  populate(result.workspaces);
  $('console').classList.remove('hidden');
  showStatus('已核對管理身分。所有操作僅作用於隔離 Preview。');
 }catch(err){
  $('console').classList.add('hidden');
  showStatus(err.message||'無法讀取管理資料',true);
 }
}
async function mutate(payload,form){
 if(state.busy)return;
 state.busy=true;
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 showStatus('正在處理管理操作，請勿重複提交…');
 try{
  await request('POST',payload);
  showStatus('操作已由伺服器受理，正在重新查詢以確認結果。');
  $('grant-confirm').value='';$('qa-confirm').value='';
  $('grant-reason').value='';$('qa-reason').value='';
 }catch(err){
  showStatus(err.message||'操作失敗',true);
 }finally{
  state.busy=false;button.disabled=false;
  $('qa-submit').disabled=true;
 }
 await refresh();
}
$('workspace').addEventListener('change',updateView);
$('plan').addEventListener('change',()=>{
 const w=current();if(!w)return;
 $('grant-phrase').textContent='SET '+$('plan').value.toUpperCase()+' '+w.workspace_id.slice(0,8);
 $('grant-confirm').value='';
});
$('reload').addEventListener('click',()=>void refresh());
$('grant-form').addEventListener('submit',event=>{
 event.preventDefault();
 const w=current();if(!w)return;
 const plan=$('plan').value,extra=Number($('extra').value);
 const phrase=$('grant-phrase').textContent;
 if($('grant-confirm').value!==phrase){showStatus('確認文字不符，尚未提交',true);return}
 void mutate({
  action:'grant',workspace_id:w.workspace_id,plan,
  extra_students:extra,reason:$('grant-reason').value,
  confirm:$('grant-confirm').value
 },event.currentTarget);
});
$('qa-form').addEventListener('submit',event=>{
 event.preventDefault();const w=current();if(!w)return;
 const expected=Number(w.qa_deleted_eligible),phrase=$('qa-phrase').textContent;
 if(expected<1||$('qa-confirm').value!==phrase){
  showStatus('沒有可釋放名額，或確認文字不符',true);return;
 }
 void mutate({
  action:'release_qa',workspace_id:w.workspace_id,
  expected_count:expected,reason:$('qa-reason').value,
  confirm:$('qa-confirm').value
 },event.currentTarget);
});
(async()=>{
 const config=await window.V4_CONFIG_READY;
 if(config?.environment!=='preview'||config.isolated!==true||
    config.projectRef==='vctisuglfoxyuwlvyjee'||
    !window.location.hostname.endsWith('.vercel.app')){
  showStatus('此管理介面僅限隔離 Preview，不支援 Production。',true);
  return;
 }
 if(!window.supabase?.createClient){showStatus('登入元件無法載入',true);return}
 state.client=window.supabase.createClient(config.url,config.publishableKey);
 await refresh();
})();
