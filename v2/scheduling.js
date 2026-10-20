/* Pure recurrence expansion for tutor V2.1. No DOM or Supabase dependencies.
   ISO weekdays 1 (Mon) ... 7 (Sun). Generate bounded windows only. */

const dateAtNoon = (key) => new Date(String(key).slice(0,10)+"T12:00:00");
const keyOf = (date) => date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
const addDays = (key,offset) => { const d=dateAtNoon(key);d.setDate(d.getDate()+offset);return keyOf(d); };
const isoDay = (date) => ((date.getDay()+6)%7)+1;
const mondayOf = (key) => {const d=dateAtNoon(key);d.setDate(d.getDate()-(isoDay(d)-1));return d;};
export const occurrenceId = (scheduleId,originalDate)=>"rule:"+scheduleId+":"+originalDate;
export const isVirtualOccurrence = (l)=>Boolean(l?.virtual_occurrence);
export const originalOccurrenceDate = (l)=>l?.scheduled_date||l?.lesson_date;

export function matchesRecurrence(schedule,day){
 if(day<schedule.starts_on||(schedule.ends_on&&day>schedule.ends_on)||(schedule.cancelled_from&&day>=schedule.cancelled_from))return false;
 const d=dateAtNoon(day);
 if(!(schedule.weekdays||[]).map(Number).includes(isoDay(d)))return false;
 const weeks=Math.round((mondayOf(day)-mondayOf(schedule.starts_on))/(7*86400000));
 return weeks>=0 && weeks % Number(schedule.every_weeks||1)===0;
}
export function findTimeConflicts(lessons,candidate,ignoreId=null){
 const a=(candidate.start_time||"").slice(0,5),b=(candidate.end_time||"").slice(0,5);
 if(!a||!b||a>=b)return [];
 return lessons.filter(l=>l.id!==ignoreId&&l.type!=="leave"&&l.type!=="moved"&&l.lesson_date===candidate.lesson_date
  &&(l.start_time||"").slice(0,5)<b&&(l.end_time||"").slice(0,5)>a);
}
function windowsFor(month,nowKey){
 const year=month.getFullYear(),m=month.getMonth();
 const a=keyOf(new Date(year,m-1,1)),b=keyOf(new Date(year,m+2,0));
 const recent=addDays(nowKey,-7),soon=addDays(nowKey,70);
 return [[a,b],[recent,soon]];
}
export function expandSchedules({schedules=[],exceptions=[],lessons=[],allowedStudents=[],month=new Date(),today=keyOf(new Date())}){
 const allowed=new Set(allowedStudents);
 const existing=new Set(lessons.filter(l=>l.schedule_id&&l.scheduled_date).map(l=>l.schedule_id+":"+l.scheduled_date));
 const byException=new Map(exceptions.map(e=>[e.schedule_id+":"+e.original_date,e]));
 const scheduleById=new Map(schedules.map(s=>[s.id,s]));
 const result=new Map();
 const makeEntry=(rule,origin,day,action,extra={})=>{
  const h1=(rule.start_time||"").slice(0,5),h2=(rule.end_time||"").slice(0,5);
  const minutes=(Number(h2.slice(0,2))*60+Number(h2.slice(3)))-(Number(h1.slice(0,2))*60+Number(h1.slice(3)));
  return {id:occurrenceId(rule.id,origin)+(action==="moved"?":origin":""),
   virtual_occurrence:true,schedule_id:rule.id,scheduled_date:origin,lesson_date:day,owner_id:rule.teacher_id,
   student_id:rule.student_id,student:"",subject:rule.subject,start_time:rule.start_time,end_time:rule.end_time,
   hourly_rate:Number(rule.hourly_rate),hours:Math.round(minutes/60*100)/100,
   total_amount:Math.round(minutes/60*Number(rule.hourly_rate)*100)/100,
   type:action==="student_leave"||action==="teacher_leave"?"leave":action==="moved"?"moved":"planned",
   leave_source:action==="student_leave"?"student":action==="teacher_leave"?"teacher":null,
   status:"未付款",...extra};
 };
 const windows=windowsFor(month,today);
 for(const rule of schedules){
  if(!allowed.has(rule.student_id))continue;
  for(const [start,end] of windows){
   const lower=start>rule.starts_on?start:rule.starts_on;
   const upper=rule.ends_on&&rule.ends_on<end?rule.ends_on:end;
   if(lower>upper)continue;
   for(let day=lower;day<=upper;day=addDays(day,1)){
    if(!matchesRecurrence(rule,day))continue;
    const composite=rule.id+":"+day,ex=byException.get(composite);
    if(ex?.action==="reschedule"){
     // Keep a small trace at the original date; actual replacement supersedes the moved lesson.
     result.set(occurrenceId(rule.id,day)+":origin",makeEntry(rule,day,day,"moved",{remarks:"已改期至 "+ex.moved_to}));
    }
    if(existing.has(composite))continue;
    if(ex?.action==="reschedule"){
     result.set(occurrenceId(rule.id,day),makeEntry(rule,day,ex.moved_to,"planned",{moved_from:day,remarks:ex.remarks||""}));
    }else if(ex?.action==="student_leave"||ex?.action==="teacher_leave"){
     result.set(occurrenceId(rule.id,day),makeEntry(rule,day,day,ex.action,{remarks:ex.remarks||""}));
    }else result.set(occurrenceId(rule.id,day),makeEntry(rule,day,day,"planned"));
   }
  }
 }
 // A moved lesson can land in the visible month even when its original date is outside expansion.
 for(const ex of exceptions){
  if(ex.action!=="reschedule"||!ex.moved_to)continue;
  const rule=scheduleById.get(ex.schedule_id);
  if(!rule||!allowed.has(rule.student_id)||existing.has(ex.schedule_id+":"+ex.original_date))continue;
  if(!windows.some(([a,b])=>ex.moved_to>=a&&ex.moved_to<=b))continue;
  if(!matchesRecurrence(rule,ex.original_date))continue;
  const id=occurrenceId(rule.id,ex.original_date);
  if(!result.has(id))result.set(id,makeEntry(rule,ex.original_date,ex.moved_to,"planned",{moved_from:ex.original_date,remarks:ex.remarks||""}));
 }
 return [...result.values()];
}
