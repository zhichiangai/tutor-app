/* V4 correction math foundation. All monetary inputs are validated and kept in cents.
 * READ/PLAN ONLY. The server must recalculate and lock rows before any mutation.
 * Existing V3 payment paths are intentionally NOT changed by this module.
 */
export function exactCents(value){
 const s=String(value??"").trim();
 if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s))throw Error("金額必須是非負數，最多兩位小數");
 const [whole,decimal=""]=s.split(".");
 const n=Number(whole)*100+Number(decimal.padEnd(2,"0"));
 if(!Number.isSafeInteger(n))throw Error("金額超出安全範圍");
 return n;
}
export const asAmount=c=>{if(!Number.isSafeInteger(c))throw Error("金額不正確");return (c/100).toFixed(2)};
const own=(batches,id)=>batches.find(b=>b.id===id);

export function correctionLedger(lesson,batches=[],items=[],corrections=[],correctionItems=[]){
 const total=exactCents(lesson.total_amount);
 let original=0,corrected=0,pending=0;
 let hasItems=false;
 for(const item of items){
  if(item.lesson_id!==lesson.id)continue;
  hasItems=true;
  const batch=own(batches,item.batch_id);
  if(!batch||batch.status==="declined")continue;
  const allocation=exactCents(item.allocated_amount);
  if(batch.status==="pending"){pending+=allocation;continue;}
  if(batch.status!=="confirmed")continue;
  original+=allocation;
  for(const line of correctionItems){
   if(line.lesson_id!==lesson.id||line.batch_id!==batch.id)continue;
   if(!corrections.some(c=>c.id===line.correction_id&&c.batch_id===batch.id))continue;
   corrected+=exactCents(line.amount);
  }
 }
 if(corrected>original)throw Error("更正額超過原始確認分配");
 const confirmed=original-corrected;
 if(!hasItems&&lesson.status==="老師已收到")return {total,original:total,corrected:0,confirmed:total,pending:0,available:0,legacy:true};
 if(!hasItems&&lesson.status==="家長已付款")pending=total;
 if(confirmed+pending>total)throw Error("付款分配超過課程費用");
 return {total,original,corrected,confirmed,pending,available:total-confirmed-pending,legacy:false};
}
export function prepareCorrection({batch,items=[],prior=[],requested=[],reason="",idempotencyKey=""}){
 if(!batch||batch.status!=="confirmed")throw Error("只可更正已確認的付款批次");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey))
  throw Error("缺少有效的冪等識別碼");
 const why=reason.trim();
 if(why.length<10||why.length>500)throw Error("更正原因須為 10–500 字");
 if(!Array.isArray(requested)||requested.length===0)throw Error("請選擇至少一堂課");
 const allocation=new Map(items.filter(i=>i.batch_id===batch.id).map(i=>[i.lesson_id,exactCents(i.allocated_amount)]));
 const already=new Map();
 for(const c of prior){
  if(c.batch_id!==batch.id)continue;
  already.set(c.lesson_id,(already.get(c.lesson_id)||0)+exactCents(c.amount));
 }
 const used=new Set(),lines=[];
 for(const entry of requested){
  const id=String(entry.lesson_id||"");
  if(used.has(id))throw Error("不可重複提交同一堂課");
  used.add(id);
  if(!allocation.has(id))throw Error("課程不屬於此付款批次");
  const cents=exactCents(entry.amount);
  if(cents<=0)throw Error("更正金額必須大於零");
  if(cents+(already.get(id)||0)>allocation.get(id))throw Error("更正金額超過原分配餘額");
  lines.push({lesson_id:id,amount:asAmount(cents),cents});
 }
 const cents=lines.reduce((n,x)=>n+x.cents,0);
 const paid=exactCents(batch.paid_amount);
 const previous=[...already.values()].reduce((a,b)=>a+b,0);
 if(cents+previous>paid)throw Error("更正總額超過原已確認付款");
 return {batch_id:batch.id,idempotency_key:idempotencyKey,
   reason:why,amount:asAmount(cents),lines:lines.map(({lesson_id,amount})=>({lesson_id,amount}))};
}
