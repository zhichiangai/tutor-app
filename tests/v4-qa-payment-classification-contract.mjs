import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../supabase/candidates/20261028_v4_payment_batch_qa_classification.sql',import.meta.url),'utf8');

test('QA candidate never changes existing payments or claims rollout',()=>{
 assert.match(sql,/CANDIDATE ONLY/);
 assert.match(sql,/begin;/i);
 assert.match(sql,/commit;/i);
 assert.doesNotMatch(sql,/\b(update|delete from)\s+public\.(payment_batches|payment_batch_items|lesson_records)\b/i);
 assert.doesNotMatch(sql,/\bsupabase_migrations\./i);
});

test('mark RLS is teacher-scoped and direct deletion is denied',()=>{
 assert.match(sql,/alter table public\.v4_payment_batch_qa_marks enable row level security;/);
 assert.match(sql,/revoke all on public\.v4_payment_batch_qa_marks from public, anon, authenticated;/);
 assert.match(sql,/grant select, insert, update on public\.v4_payment_batch_qa_marks to authenticated;/);
 for(const kind of ['select','insert','update']){
  assert.match(sql,new RegExp('create policy v4_qa_mark_teacher_'+kind));
 }
 assert.equal((sql.match(/b\.teacher_id=\(select auth\.uid\(\)\)/g)||[]).length,4);
 assert.doesNotMatch(sql,/grant\s+delete\s+on\s+public\.v4_payment_batch_qa_marks/i);
});

test('only the owning teacher can classify and every change is audited',()=>{
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/v_teacher is distinct from v_actor/);
 assert.match(sql,/new\.batch_id is distinct from old\.batch_id/);
 assert.match(sql,/new\.classified_by:=v_actor/);
 assert.match(sql,/new\.classified_at:=pg_catalog\.clock_timestamp\(\)/);
 assert.match(sql,/insert into tutor_private\.v4_payment_batch_qa_audit/);
 assert.match(sql,/revoke all on tutor_private\.v4_payment_batch_qa_audit from public, anon, authenticated/);
 assert.match(sql,/revoke execute on function tutor_private\.v4_guard_and_audit_payment_qa_mark\(\)/);
});

test('classification refuses undocumentable or unchanged changes',()=>{
 assert.match(sql,/char_length\(btrim\(new\.reason\)\) not between 10 and 500/);
 assert.match(sql,/new\.is_qa is not distinct from old\.is_qa/);
 assert.match(sql,/v_previous:=old\.is_qa/);
});
