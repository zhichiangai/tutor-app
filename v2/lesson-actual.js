/* Shared lesson-time calculations for V2.5. Values are decimal HOURS, not hh.mm.
   1.2 hours = 72 minutes. This module does not display prices. */
export function durationHours(start,end){
 const re=/^([01]\d|2[0-3]):[0-5]\d$/;
 if(!re.test(start||"")||!re.test(end||""))return null;
 const minutes=(Number(end.slice(0,2))*60+Number(end.slice(3)))-(Number(start.slice(0,2))*60+Number(start.slice(3)));
 return minutes>0&&minutes<=960?Math.round(minutes/60*100)/100:null;
}
export function actualDefaults(lesson){
 const plannedStart=(lesson.start_time||"").slice(0,5),plannedEnd=(lesson.end_time||"").slice(0,5);
 return {
  scheduledStart:plannedStart,scheduledEnd:plannedEnd,
  actualStart:(lesson.actual_start_time||plannedStart).slice(0,5),
  actualEnd:(lesson.actual_end_time||plannedEnd).slice(0,5),
  actualHours:Number(lesson.actual_hours??(lesson.type==="lesson"?lesson.hours:durationHours(plannedStart,plannedEnd))??0)
 };
}
export function validateActual(start,end,hours){
 const derived=durationHours(start,end),h=Number(hours);
 if(derived===null)throw Error("實際結束時間必須晚於開始時間，且在同一天內");
 if(!Number.isFinite(h)||h<=0||h>16||Math.abs(Math.round(h*100)-h*100)>1e-7)throw Error("計費時數請輸入 0.01～16 小時，最多兩位小數");
 return {actual_start_time:start,actual_end_time:end,actual_hours:h,hours:h};
}
export function isPaymentLocked(lesson,batches=[],items=[],requests=[]){
 if(!lesson||lesson.type!=="lesson")return false;
 if(["老師已收到","家長已付款"].includes(lesson.status))return true;
 if(requests.some(r=>r.lesson_id===lesson.id&&r.kind==="payment"&&["pending","approved"].includes(r.status)))return true;
 return items.some(i=>i.lesson_id===lesson.id&&batches.some(b=>b.id===i.batch_id&&["pending","confirmed"].includes(b.status)));
}
