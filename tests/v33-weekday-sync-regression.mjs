// V3.3 regression: updating a fixed schedule date must keep weekdays intuitive.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const app=read("../v2/app.js"),html=read("../v2/index.html");
const begin=app.indexOf("function weekdayForDate("),end=app.indexOf("function openSharedCourseForm(",begin);
assert.ok(begin>0&&end>begin,"weekday helper must be present in application");
const src=app.slice(begin,end);
function fixture(date="2026-10-21",chosen=[3]){
 const fields=new Map();
 fields.set("#date",{value:date});
 fields.set("#hint",{textContent:""});
 const inputs=Array.from({length:7},(_,i)=>({value:String(i+1),checked:chosen.includes(i+1)}));
 const $=k=>fields.get(k);
 const document={querySelectorAll:selector=>selector==="#weekdays input[type=checkbox]"?inputs:[]};
 const parseDate=s=>new Date(s+"T12:00:00");
 const dateKey=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
 const api=new Function("document","$","parseDate","dateKey",src+"\nreturn {weekdayForDate,syncRecurringWeekdays};")(document,$,parseDate,dateKey);
 const chosenNow=()=>inputs.filter(x=>x.checked).map(x=>Number(x.value));
 const select=(arr)=>inputs.forEach(x=>x.checked=arr.includes(Number(x.value)));
 const changeDate=(v)=>{fields.get("#date").value=v;return api.syncRecurringWeekdays("date","weekdays","hint",true)};
 const refresh=()=>api.syncRecurringWeekdays("date","weekdays","hint",false);
 return {api,fields,inputs,chosenNow,select,changeDate,refresh};
}
test("changing from Wednesday 2026-10-21 to Tuesday 2026-10-20 changes a single recurring weekday",()=>{
 const x=fixture("2026-10-21",[3]);
 assert.deepEqual(x.changeDate("2026-10-20"),[2]);
 assert.deepEqual(x.chosenNow(),[2]);
 assert.match(x.fields.get("#hint").textContent,/每週二/);
});
test("multiple recurring weekdays stay Mon/Wed/Fri when the start date changes",()=>{
 const x=fixture("2026-10-21",[1,3,5]);
 assert.deepEqual(x.changeDate("2026-10-20"),[1,3,5]);
 assert.deepEqual(x.chosenNow(),[1,3,5]);
 assert.match(x.fields.get("#hint").textContent,/多個上課星期/);
});
test("the weekday can still be manually chosen after date auto-sync",()=>{
 const x=fixture("2026-10-21",[3]);
 x.changeDate("2026-10-20");
 x.select([4]);
 x.refresh();
 assert.deepEqual(x.chosenNow(),[4]);
});
test("invalid dates do not overwrite choices; all weekdays unselected prompts a hint",()=>{
 const x=fixture("2026-10-21",[3]);
 x.changeDate("2026-02-30");
 assert.deepEqual(x.chosenNow(),[3]);
 x.select([]);
 x.refresh();
 assert.match(x.fields.get("#hint").textContent,/至少選擇一個/);
});
test("teacher, guardian, and student scheduling forms wire date changes and preserve date input",()=>{
 for(const id of ["schedule-weekday-hint","record-weekday-hint","shared-weekday-hint","shared-course-date-label-text"]){
  assert.ok(html.includes('id="'+id+'"'),id+" missing");
 }
 assert.ok(app.includes('$("#schedule-start").addEventListener("change"'));
 assert.ok(app.includes('$("#shared-course-date").addEventListener("change"'));
 assert.ok(app.includes('$("#record-date").addEventListener("change"'));
 assert.ok(app.includes('"weekly","biweekly"].includes($("#record-repeat").value)'));
 assert.ok(!app.includes('$("#shared-course-date-label").innerHTML='),"shared date input must not be recreated at form open");
});
