import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261106031000_v5_3_team_billing_foundation.sql',import.meta.url),'utf8');

test('No V4 tuition, receipt or lesson mutation is in Team billing migration',()=>{
 assert.doesNotMatch(sql,/\b(?:update|delete\s+from|insert\s+into|truncate|alter\s+table)\s+public\.(?:students|lesson_records|payment_batches|payment_batch_items)\b/i);
 assert.doesNotMatch(sql,/\bgrant\s+.*\bpublic\.(?:lesson_records|payment_batches)\b/i);
 assert.doesNotMatch(sql,/alter\s+table\s+public\.v5_team_lessons\s+add\s+column\s+(?:amount|rate|tuition)/i);
});
test('Fee and audit rows stay inside nonexposed private schema',()=>{
 for(const name of ['v5_team_lesson_fees','v5_team_billing_audit']){
  assert.match(sql,new RegExp('create table tutor_private\\.'+name+'\\('));
  assert.match(sql,new RegExp('alter table tutor_private\\.'+name+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on tutor_private\\.'+name+'\\s+from public,anon,authenticated'));
  assert.doesNotMatch(sql,new RegExp('grant\\s+(?:select|insert|update|delete|all)\\s+on tutor_private\\.'+name+'\\s+to authenticated','i'));
 }
});
test('Manager-only RPC rechecks auth and governance on each call',()=>{
 for(const name of ['v5_confirm_team_lesson_fee','v5_team_billing_overview']){
  const rpc=new RegExp('create function public\\.'+name+'\\([\\s\\S]*?end;\\$\\$;','i').exec(sql)?.[0];
  assert.ok(rpc,name+' must be a defined secure function');
  assert.match(rpc,/security definer set search_path=''/);
  assert.match(rpc,/auth\.uid\(\)/);
  assert.match(rpc,/v5_team_governance/);
  assert.match(rpc,/manager_user_id=v_actor/);
  assert.match(rpc,/plan_code='team'/);
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'\\('));
 }
});
test('Only completed past courses can be billed once and financial facts are frozen',()=>{
 assert.match(sql,/v_lesson\.status<>'completed'/);
 assert.match(sql,/v_lesson\.lesson_end>now\(\)/);
 assert.match(sql,/lesson_id uuid primary key references public\.v5_team_lessons/);
 assert.match(sql,/p_hourly_rate_cents::numeric\*v_seconds\/3600/);
 assert.match(sql,/v_seconds>86400 or mod\(v_seconds,60\)<>0/);
 assert.match(sql,/create trigger v5_guard_billed_lesson/);
 assert.match(sql,/raise exception '已確認費用的課程不能直接更改計價內容'/);
 assert.match(sql,/insert into tutor_private\.v5_team_billing_audit/);
});
test('Monthly manager billing report has TWD-local boundaries and no collection status',()=>{
 assert.match(sql,/at time zone 'Asia\/Taipei'/);
 assert.match(sql,/confirmed_total_cents/);
 assert.match(sql,/pending_rows/);
 assert.match(sql,/currency','TWD'/);
 assert.doesNotMatch(sql,/'payment_received'|'paid'|'refunded'/i);
});
