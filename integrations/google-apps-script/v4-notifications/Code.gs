/**
 * 好好上課 V4.0 — Google Workspace notification worker (STAGING TEMPLATE).
 *
 * Script Properties required:
 * V4_BRIDGE_URL = https://<test-project>.supabase.co/functions/v1/v4-gas-bridge
 * V4_BRIDGE_SECRET = matching Supabase Edge secret
 * V4_FROM_EMAIL = a verified Workspace alias, e.g. tutor-notify@rapid4grad.com
 *
 * This is NOT a public GAS web app: never deploy doGet/doPost endpoints.
 * Authorize with the intended Workspace account. Install time trigger only after testing.
 * Do not connect to production until the user explicitly authorizes rollout.
 */
function v4Settings_(){
  const p=PropertiesService.getScriptProperties();
  const settings={
    url:p.getProperty('V4_BRIDGE_URL'),
    secret:p.getProperty('V4_BRIDGE_SECRET'),
    from:p.getProperty('V4_FROM_EMAIL')
  };
  if(!settings.url||!settings.secret||!settings.from)throw Error('V4 Script Properties 尚未設定完整');
  if(!/^https:\/\/[^/]+\/functions\/v1\/v4-gas-bridge$/.test(settings.url))throw Error('V4 bridge 網址格式不正確');
  return settings;
}
function v4Post_(body){
  const s=v4Settings_();
  const response=UrlFetchApp.fetch(s.url,{
    method:'post',
    contentType:'application/json',
    headers:{'x-v4-mail-key':s.secret},
    payload:JSON.stringify(body),
    muteHttpExceptions:true
  });
  const code=response.getResponseCode();
  if(code!==200)throw Error('V4 bridge 回應失敗：HTTP '+code);
  return JSON.parse(response.getContentText());
}
function v4Send_(item){
  const s=v4Settings_();
  const sender=s.from.trim().toLowerCase();
  const effective=Session.getEffectiveUser().getEmail().toLowerCase();
  const aliases=GmailApp.getAliases().map(a=>a.toLowerCase());
  if(sender!==effective&&!aliases.includes(sender)){
    throw Error('Workspace 未啟用預期寄件別名；停止寄信以避免使用錯誤品牌地址');
  }
  if(MailApp.getRemainingDailyQuota()<1)throw Error('Google Workspace 今日寄信額度不足');
  if(!item.recipient||!item.subject||!item.body)throw Error('缺少信件內容');
  const options={name:'好好上課'};
  if(sender!==effective)options.from=sender;
  GmailApp.sendEmail(item.recipient,item.subject,item.body,options);
}
function processV4MailQueue(){
  const result=v4Post_({action:'claim',limit:5});
  const items=result.messages||[];
  items.forEach(function(item){
    let ok=false,error='';
    try{v4Send_(item);ok=true;}catch(e){error=String(e&&e.message||e).slice(0,400);}
    try{
      v4Post_({action:'ack',id:item.id,ok:ok,error:error});
    }catch(ackError){
      // An ACK failure after Gmail accepted a message can result in a retry:
      // investigate the queue before retrying a processing lease manually.
      console.error('V4 ACK 未完成（可能重寄），訊息 ID:',item.id);
      throw ackError;
    }
  });
}
function inspectV4MailSettings(){
  const s=v4Settings_();
  const current=Session.getEffectiveUser().getEmail();
  console.log('Workspace 執行帳號：'+current);
  console.log('V4 預期寄件別名：'+s.from);
  console.log('已可用的別名（數量）：'+GmailApp.getAliases().length);
  console.log('今日剩餘收件者配額：'+MailApp.getRemainingDailyQuota());
  // NEVER log the shared bridge secret or its full HTTP responses.
}
function installV4MailTrigger(){
  v4Settings_(); // Fail before installing an unusable trigger.
  const existing=ScriptApp.getProjectTriggers()
    .filter(t=>t.getHandlerFunction()==='processV4MailQueue');
  if(existing.length)throw Error('V4 寄信排程已存在，請勿重複建立');
  ScriptApp.newTrigger('processV4MailQueue').timeBased().everyMinutes(5).create();
}
