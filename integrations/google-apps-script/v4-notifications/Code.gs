/** 好好上課 V4.0.0-dev.2 — isolated Workspace worker, never a public Web App.
 * Required: V4_BRIDGE_URL, V4_BRIDGE_SECRET, V4_FROM_EMAIL,
 * V4_STAGING_PROJECT_REF, V4_TEST_RECIPIENTS (comma-separated QA recipients).
 * V4_MAIL_ENABLED must be exactly "true" only for an approved isolated test; install a trigger after acceptance.
 * inspectV4MailSettings is read-only and works before bridge configuration.
 */
function v4InspectSender_(){
  const sender='tutor-notify@rapid4grad.com';
  const effective=String(Session.getEffectiveUser().getEmail()||'').toLowerCase();
  const aliases=GmailApp.getAliases().map(a=>a.toLowerCase());
  return {sender:sender,senderAvailable:effective===sender||aliases.includes(sender),
    aliasCount:aliases.length,remainingRecipients:MailApp.getRemainingDailyQuota()};
}
function inspectV4MailSettings(){
  const report=v4InspectSender_();
  // No account list, alias list, bridge secret or private message content in logs.
  console.log(JSON.stringify(report));
  return report;
}
function v4Settings_(){
  const p=PropertiesService.getScriptProperties();
  const settings={url:p.getProperty('V4_BRIDGE_URL'),secret:p.getProperty('V4_BRIDGE_SECRET'),
    from:p.getProperty('V4_FROM_EMAIL'),ref:p.getProperty('V4_STAGING_PROJECT_REF')};
  if(settings.from!=='tutor-notify@rapid4grad.com')throw Error('請先設定指定的好好上課寄件別名');
  if(!/^[a-z]{20}$/.test(settings.ref||'')||settings.ref==='vctisuglfoxyuwlvyjee')
    throw Error('只能連接已核對的隔離測試專案');
  if(settings.url!=='https://'+settings.ref+'.supabase.co/functions/v1/v4-gas-bridge'||!settings.secret)
    throw Error('V4 隔離 bridge 設定不完整');
  if(p.getProperty('V4_MAIL_ENABLED')!=='true')throw Error('V4 測試寄信尚未啟用');
  settings.recipients=String(p.getProperty('V4_TEST_RECIPIENTS')||'').split(',')
    .map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!settings.recipients.length)throw Error('請先指定獲准的 QA 收件者');
  return settings;
}
function v4Post_(body){
  const s=v4Settings_();
  const response=UrlFetchApp.fetch(s.url,{method:'post',contentType:'application/json',
    headers:{'x-v4-mail-key':s.secret},payload:JSON.stringify(body),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('V4 bridge 暫時無法確認，請檢查執行紀錄');
  return JSON.parse(response.getContentText());
}
function v4Send_(item){
  const s=v4Settings_(),report=v4InspectSender_();
  if(!report.senderAvailable)throw Error('Workspace 尚未啟用指定寄件別名');
  if(report.remainingRecipients<1)throw Error('今日寄信額度不足');
  if(!s.recipients.includes(String(item.recipient||'').toLowerCase())||
     !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(item.recipient||''))
    throw Error('收件者不在核准的 QA 清單');
  if(!item.subject||!item.body||/[\r\n]/.test(item.subject))throw Error('信件格式不正確');
  const options={name:'好好上課'};
  if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!==s.from)options.from=s.from;
  GmailApp.sendEmail(item.recipient,item.subject,item.body,options);
}
function v4JournalKey_(id){return 'V4_DELIVERY_'+id;}
function v4Acknowledge_(entry){
  v4Post_({action:'ack',id:entry.id,lease:entry.lease,ok:entry.state==='sent',
    uncertain:entry.state==='uncertain',error:entry.state==='uncertain'?'delivery_uncertain':''});
}
function processV4MailQueue(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return;
  try{
    v4Settings_();
    const report=v4InspectSender_();
    if(!report.senderAvailable||report.remainingRecipients<1)throw Error('寄件別名或額度尚未就緒');
    const p=PropertiesService.getScriptProperties();
    // Flush durable pending ACKs first. Never send a journalled message again.
    const entries=p.getProperties();
    for(const key of Object.keys(entries).filter(k=>k.indexOf('V4_DELIVERY_')===0)){
      const entry=JSON.parse(entries[key]);
      if(entry.state==='started')entry.state='uncertain';
      v4Acknowledge_(entry);p.deleteProperty(key);
    }
    // Claim one at a time; do not strand a batch when an ACK fails.
    for(let n=0;n<5;n++){
      if(MailApp.getRemainingDailyQuota()<1)break;
      const item=(v4Post_({action:'claim',limit:1}).messages||[])[0];
      if(!item)break;
      const key=v4JournalKey_(item.id),entry={id:item.id,lease:item.lease_token,state:'started'};
      // Persist before Gmail. A crash after this point requires inspection, not blind retry.
      p.setProperty(key,JSON.stringify(entry));
      try{v4Send_(item);entry.state='sent';}
      catch(e){entry.state='uncertain';}
      p.setProperty(key,JSON.stringify(entry));
      try{v4Acknowledge_(entry);p.deleteProperty(key);}
      catch(e){console.error('V4 ACK 未完成，已保留紀錄；不會自動重寄。訊息 ID:',item.id);throw e;}
    }
  }finally{lock.releaseLock();}
}
function installV4MailTrigger(){
  const lock=LockService.getScriptLock();lock.waitLock(5000);
  try{
    v4Settings_();
    if(!v4InspectSender_().senderAvailable)throw Error('請先確認指定寄件別名');
    if(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='processV4MailQueue'))
      throw Error('V4 寄信排程已存在');
    ScriptApp.newTrigger('processV4MailQueue').timeBased().everyMinutes(5).create();
  }finally{lock.releaseLock();}
}
