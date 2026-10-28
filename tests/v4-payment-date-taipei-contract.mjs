import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source=read('supabase/migrations/20261024050000_v40_apply_payment_corrections.sql');
const patched=read('supabase/migrations/20261029024000_v4_payment_date_taipei.sql');
const start='create or replace function tutor_private.submit_range_payment(';
const review='create or replace function tutor_private.review_range_payment(';
const a=source.indexOf(start),b=source.indexOf(review,a);
const c=patched.indexOf(start),d=patched.indexOf(review,c);
assert.ok(a>0&&b>a&&c>0&&d>c);
const oldSubmit=source.slice(a,b).trim(),oldReview=source.slice(b).trim();
const newSubmit=patched.slice(c,d).trim();
const newReview=patched.slice(d,patched.lastIndexOf('commit;')).trim();
const replacement="(now() at time zone 'Asia/Taipei')::date";

test('forward-only migration only updates the two originally UTC-sensitive checks',()=>{
 assert.equal((oldSubmit.match(/current_date/g)||[]).length,1);
 assert.equal((oldReview.match(/current_date/g)||[]).length,1);
 assert.equal(newSubmit,oldSubmit.replace('current_date',replacement),
   'All parent payment RPC permissions, locks and allocation rules must be unchanged');
 assert.equal(newReview,oldReview.replace('current_date',replacement),
   'All teacher receipt RPC permissions, locks and allocation rules must be unchanged');
 assert.match(patched,/^begin;/m);
 assert.match(patched,/^commit;/m);
 assert.match(patched,/Missing prior V4 payment functions/);
 assert.doesNotMatch(patched,/\b(drop|truncate|delete|update|insert)\s+(?:table\s+)?(?:from\s+|into\s+)?public\.(payment_batches|payment_batch_items|lesson_records)\b/i);
 assert.equal((patched.match(/at time zone 'Asia\/Taipei'/g)||[]).length,2);
});

test('Taipei business day differs from UTC during the real midnight crossing',()=>{
 const t=new Date('2026-10-28T18:00:00Z');
 assert.equal(t.toISOString().slice(0,10),'2026-10-28');
 const pieces=new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(t);
 const p=Object.fromEntries(pieces.map(x=>[x.type,x.value]));
 assert.equal([p.year,p.month,p.day].join('-'),'2026-10-29');
 assert.match(newSubmit,/p_paid_on>\(now\(\) at time zone 'Asia\/Taipei'\)::date/);
 assert.match(newReview,/p_received_on>\(now\(\) at time zone 'Asia\/Taipei'\)::date/);
});
