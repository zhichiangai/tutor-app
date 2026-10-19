/* V2.2 shared agenda renderer for desktop and phone. Display only: no data writes. */
export function monthAgendaMarkup(lessons,helpers,{limit=0}={}){
 const {studentName,prettyDate,timeLabel,statusLabel,esc}=helpers;
 const shown=limit>0?lessons.slice(0,limit):lessons;
 if(!shown.length)return '<p class="empty">本月還沒有課程；老師可以新增單次課程或固定課表。</p>';
 const groups=new Map();
 for(const lesson of shown){
  const k=lesson.lesson_date,arr=groups.get(k)||[];arr.push(lesson);groups.set(k,arr);
 }
 return [...groups.entries()].map(([date,entries])=>
  '<section class="month-agenda-group">'+
   '<div class="month-agenda-heading"><strong>'+esc(prettyDate(date))+'</strong>'+
   '<button type="button" class="text-link" data-day="'+esc(date)+'">管理當日 ↗</button></div>'+
   entries.map(l=>{
    const name=studentName(l),label=statusLabel(l),isDone=l.type==="lesson";
    return '<div class="month-agenda-row"><div class="month-agenda-dot '+(isDone?'done':l.type==="leave"||l.type==="moved"?'exception':'')+'"></div>'+
     '<div class="month-agenda-info"><strong>'+esc(name)+' · '+esc(l.subject||"課程")+'</strong>'+
     '<small>'+esc(timeLabel(l.start_time))+'–'+esc(timeLabel(l.end_time))+'</small></div>'+
     '<span class="pill '+(isDone?'paid':l.type==="leave"||l.type==="moved"?'leave':'')+'">'+esc(label)+'</span></div>';
   }).join("")+'</section>'
 ).join("");
}
export function monthSummary(lessons){
 const done=lessons.filter(l=>l.type==="lesson").length;
 const future=lessons.filter(l=>l.type==="planned").length;
 const exception=lessons.filter(l=>l.type==="leave"||l.type==="moved").length;
 return '已完成 '+done+' 堂 · 預計 '+future+' 堂'+(exception?' · 異動 '+exception+' 筆':'');
}
