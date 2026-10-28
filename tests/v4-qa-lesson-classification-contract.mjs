import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/candidates/20261029_v4_qa_lesson_and_legacy_receipt.sql',import.meta.url),'utf8');
const batchSql=readFileSync(new URL('../supabase/candidates/20261028_v4_payment_batch_qa_classification.sql',import.meta.url),'utf8');

test('lesson and legacy receipt QA remain candidate-only with intact historical records',()=>{
 assert.match(sql,/CANDIDATE ONLY/);
 assert.match(sql,/begin;/i);
 assert.match(sql,/commit;/i);
 assert.doesNotMatch(sql,/\bupdate\s+(?:public\.)?(?:lesson_records|payment_batches|payment_batch_items)\b/i);
 assert.doesNotMatch(sql,/\bdelete\s+from\s+(?:public\.)?(?:lesson_records|payment_batches|payment_batch_items)\b/i);
});

test('teacher-only RLS prevents parent/student/self-assigned QA classification',()=>{
 assert.match(sql,/alter table public\.v4_lesson_qa_marks enable row level security;/);
 assert.match(sql,/grant select, insert, update on public\.v4_lesson_qa_marks to authenticated;/);
 for(const policy of ['select','insert','update']){
  assert.match(sql,new RegExp('create policy v4_lesson_qa_teacher_'+policy));
 }
 assert.match(sql,/l\.owner_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/v_owner is distinct from v_actor/);
 assert.doesNotMatch(sql,/grant\s+delete\s+on\s+public\.v4_lesson_qa_marks/i);
});

test('whole simulated lesson cannot silently hide unclassified confirmed real cash',()=>{
 assert.match(sql,/left join public\.v4_payment_batch_qa_marks m/);
 assert.match(sql,/b\.status in \('confirmed','pending'\)/);
 assert.match(sql,/coalesce\(m\.is_qa,false\)=false/);
 assert.match(sql,/Classify pending\/confirmed simulated payment batches/);
 assert.match(batchSql,/create table public\.v4_payment_batch_qa_marks/);
});

test('legacy simulated receipt requires owner, specific received status, zero batch items',()=>{
 assert.match(sql,/classification='simulated_legacy_receipt'/);
 assert.match(sql,/v_status <> '老師已收到'/);
 assert.match(sql,/exists \(select 1 from public\.payment_batch_items i/);
 assert.match(sql,/v_type <> 'lesson'/);
 assert.match(sql,/new\.lesson_id is distinct from old\.lesson_id/);
});

test('append-only private audit records every classification change',()=>{
 assert.match(sql,/create table tutor_private\.v4_lesson_qa_audit/);
 assert.match(sql,/revoke all on tutor_private\.v4_lesson_qa_audit from public, anon, authenticated;/);
 assert.match(sql,/insert into tutor_private\.v4_lesson_qa_audit/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/revoke execute on function tutor_private\.v4_guard_and_audit_lesson_qa_mark\(\)/);
 assert.match(sql,/changed_at/);
});
