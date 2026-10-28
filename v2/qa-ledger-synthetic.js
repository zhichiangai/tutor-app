import {lessonAllocation} from './payment-ledger.js';
const months=['2026-09','2026-10','2026-11'];let pos=1;
const lessons=[
 {id:'real-oct',type:'lesson',student_id:'sample-a',student:'模擬學生 A',subject:'數學',lesson_date:'2026-10-16',total_amount:1000,status:'老師已收到'},
 {id:'qa-oct',type:'lesson',student_id:'sample-b',student:'模擬學生 B',subject:'理化',lesson_date:'2026-10-18',total_amount:1000,status:'老師已收到'},
 {id:'legacy-oct',type:'lesson',student_id:'sample-a',student:'模擬學生 A',subject:'英文',lesson_date:'2026-10-20',total_amount:700,status:'老師已收到'},
 {id:'cross-sep',type:'lesson',student_id:'sample-c',student:'模擬學生 C',subject:'數學',lesson_date:'2026-09-30',total_amount:800,status:'未付款'}
];
const batches=[
 {id:'qa-part-400',status:'confirmed',period_start:'2026-10-16',period_end:'2026-10-16',paid_amount:400,received_on:'2026-10-19',subject:'real-oct'},
 {id:'real-part-600',status:'confirmed',period_start:'2026-10-16',period_end:'2026-10-16',paid_amount:600,received_on:'2026-10-20',subject:'real-oct'},
 {id:'qa-full-300',status:'confirmed',period_start:'2026-10-18',period_end:'2026-10-18',paid_amount:300,received_on:'2026-10-19',subject:'qa-oct'},
 {id:'qa-full-700',status:'confirmed',period_start:'2026-10-18',period_end:'2026-10-18',paid_amount:700,received_on:'2026-10-20',subject:'qa-oct'},
 {id:'cross-month-800',status:'confirmed',period_start:'2026-09-29',period_end:'2026-10-02',paid_amount:800,received_on:'2026-10-04',subject:'cross-sep'}
];
const items=batches.map(b=>({batch_id:b.id,lesson_id:b.subject,allocated_amount:b.paid_amount}));
const qaTags={qaBatchIds:['qa-part-400','qa-full-300','qa-full-700'],
 qaLessonIds:['qa-oct'],qaLegacyReceiptLessonIds:['legacy-oct']};
const money=x=>'NT$ '+Number(x).toLocaleString('zh-TW',{maximumFractionDigits:2});
const qaBatch=b=>qaTags.qaBatchIds.includes(b.id);
const qaLesson=l=>qaTags.qaLessonIds.includes(l.id);
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const el=id=>document.getElementById(id);
function render(){
 const month=months[pos],from=month+'-01';
 const end=month==='2026-09'?'2026-09-30':month==='2026-10'?'2026-10-31':'2026-11-30';
 el('month-label').textContent=month.slice(0,4)+' 年 '+Number(month.slice(5))+' 月';
 el('previous').disabled=pos===0;el('next').disabled=pos===months.length-1;
 const all=lessons.filter(l=>l.lesson_date.startsWith(month));
 const official=all.filter(l=>!qaLesson(l));
 const subtotal=official.reduce((a,l)=>a+lessonAllocation(l,batches,items,[],[],[],qaTags).total,0);
 const paid=official.reduce((a,l)=>a+lessonAllocation(l,batches,items,[],[],[],qaTags).confirmed,0);
 el('summary').innerHTML=[
  ['本月正式應收',money(subtotal)],
  ['正式已確認收款',money(paid)],
  ['尚未收款',money(subtotal-paid)]
 ].map(([key,value])=>'<article class="card"><div class="k">'+key+'</div><div class="number">'+value+'</div></article>').join('');
 const showing=el('show-qa').checked?all:official;
 el('lesson-rows').innerHTML=showing.length?showing.map(l=>{
  const a=lessonAllocation(l,batches,items,[],[],[],qaTags),qa=qaLesson(l),legacy=qaTags.qaLegacyReceiptLessonIds.includes(l.id);
  const classification=qa?'整堂模擬課程':legacy?'舊式模擬收款':'正式課程';
  return '<tr><td>'+escapeHTML(l.lesson_date)+'</td><td>'+escapeHTML(l.student+' · '+l.subject)+'</td>'+
   '<td><span class="tag '+(qa||legacy?'qa':'')+'">'+classification+'</span></td><td>'+money(a.total)+'</td><td>'+money(a.confirmed)+'</td><td>'+money(a.available)+'</td></tr>';
 }).join(''):'<tr><td colspan="6">本月沒有課程紀錄。</td></tr>';
 const matching=batches.filter(b=>b.period_start<=end&&b.period_end>=from)
  .filter(b=>el('show-qa').checked||!qaBatch(b));
 el('history-scope').textContent=from+' 至 '+end+' 的課程期間；跨月批次可在相鄰月份出現。';
 el('batch-rows').innerHTML=matching.length?matching.map(b=>{
  const qa=qaBatch(b);
  return '<tr><td>'+escapeHTML(b.id)+'</td><td>'+escapeHTML(b.period_start+' 至 '+b.period_end)+'</td>'+
    '<td>'+escapeHTML(b.subject)+' · '+money(b.paid_amount)+'</td><td><span class="tag '+(qa?'qa':'')+'">'+
    (qa?'QA 模擬付款':'正式付款')+'</span></td><td>'+(qa?'否（不計入）':'是（合成已確認）')+'</td></tr>';
 }).join(''):'<tr><td colspan="5">此期間沒有符合篩選的付款批次。</td></tr>';
}
el('previous').addEventListener('click',()=>{if(pos>0){pos--;render()}});
el('next').addEventListener('click',()=>{if(pos<months.length-1){pos++;render()}});
el('show-qa').addEventListener('change',render);
render();
