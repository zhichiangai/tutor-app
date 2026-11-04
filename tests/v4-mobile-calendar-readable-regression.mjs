// No private credentials or live data; verifies mobile readability contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {monthAgendaMarkup} from '../v2/calendar-view.js';

const css=readFileSync(new URL('../v2/style.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../v2/index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');

test('mobile rules override desktop event buttons with compact lesson counts',()=>{
 const desktop=css.indexOf('.calendar-event.lesson-event-click{display:block');
 const narrow=css.lastIndexOf('#view-calendar .calendar-cell .calendar-event.lesson-event-click{display:none}');
 assert.ok(desktop>=0&&narrow>desktop,'mobile override must follow desktop event display');
 assert.match(css,/\.calendar-cell \.mobile-lesson-count\{display:block/);
 assert.match(css,/#view-calendar>\.agenda-card\{display:block/);
 assert.match(css,/#view-calendar \.calendar-cell \.more-count\{display:none/);
});
test('full course name and time can wrap at narrow widths without ellipsis',()=>{
 const start=css.lastIndexOf('/* V4 mobile month calendar:');
 assert.ok(start>=0);
 const mobile=css.slice(start);
 assert.match(mobile,/\.month-agenda-info strong,[\s\S]*?\.month-agenda-info small\{/);
 assert.match(mobile,/white-space:normal;text-overflow:clip;overflow-wrap:anywhere/);
 assert.match(mobile,/grid-template-areas:"mark info" "\. status"/);
 assert.match(html,/手機點日期可看完整課程/);
 assert.match(code,/function openDay\(day\)/);
 assert.match(code,/state\.selected=day/);
});
test('synthetic long student names and time stay intact and escaped in accessible month rows',()=>{
 const long='CI 好長好長的學生名字 英文 V4 Calendar XYZ';
 const lessons=[{id:'safe-id',lesson_date:'2026-11-04',type:'planned',
  subject:'數學 & 理化',start_time:'17:00',end_time:'19:00'}];
 const html=monthAgendaMarkup(lessons,{
  studentName:()=>long,prettyDate:()=> '2026/11/04',
  timeLabel:x=>x,statusLabel:()=> '已安排',
  esc:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 });
 assert.ok(html.includes(long));
 assert.ok(html.includes('數學 &amp; 理化'));
 assert.ok(html.includes('17:00–19:00'));
 assert.ok(html.includes('已安排'));
 assert.match(html,/data-action="open-lesson"/);
 assert.doesNotMatch(html,/NT\$|hourly_rate|total_amount/);
});
