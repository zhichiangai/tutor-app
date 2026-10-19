/* V2.3 money calculations. Currency is persisted in numeric(12,2); use cents in UI. */
export const cents = value => Math.round(Number(value||0)*100);
export const amount = value => cents(value)/100;
export function lessonAllocation(lesson,batches=[],items=[],requests=[]){
 const related=items.filter(i=>i.lesson_id===lesson.id);
 let confirmed=0,pending=0;
 for(const item of related){
  const batch=batches.find(b=>b.id===item.batch_id);
  if(batch?.status==="confirmed")confirmed+=cents(item.allocated_amount);
  else if(batch?.status==="pending")pending+=cents(item.allocated_amount);
 }
 const total=cents(lesson.total_amount);
 if(!related.length&&lesson.status==="老師已收到")confirmed=total;
 else if(!related.length&&lesson.status==="家長已付款")pending=total;
 const legacyPending=!related.length&&requests.some(r=>r.lesson_id===lesson.id&&r.kind==="payment"&&r.status==="pending");
 if(legacyPending)pending=total;
 confirmed=Math.min(total,confirmed);
 pending=Math.min(total-confirmed,pending);
 const available=Math.max(0,total-confirmed-pending);
 return {total:total/100,confirmed:confirmed/100,pending:pending/100,available:available/100,legacyPending};
}
export function eligiblePeriodLessons({lessons=[],batches=[],items=[],requests=[],studentId,start,end}){
 return lessons.filter(l=>l.type==="lesson"&&l.student_id===studentId&&l.lesson_date>=start&&l.lesson_date<=end)
  .sort((a,b)=>(a.lesson_date+" "+(a.start_time||"")).localeCompare(b.lesson_date+" "+(b.start_time||"")))
  .map(l=>({lesson:l,allocation:lessonAllocation(l,batches,items,requests)}))
  .filter(r=>r.allocation.available>0);
}
export function allocateOldestFirst(rows,paid){
 let remaining=cents(paid);
 return rows.map(({lesson,allocation})=>{
  const take=Math.min(remaining,cents(allocation.available));remaining-=take;
  return {lesson_id:lesson.id,allocated_amount:take/100,lesson};
 }).filter(x=>x.allocated_amount>0);
}
