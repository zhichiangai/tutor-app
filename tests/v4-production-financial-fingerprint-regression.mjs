// Offline contract for the metadata-only Production financial fingerprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/diagnostics/v4_financial_function_fingerprint_readonly.sql',import.meta.url),'utf8');
const withoutComments=sql.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');

test('financial fingerprint never reads personal records or mutates schema/data',()=>{
 assert.match(sql,/READ ONLY/);
 assert.doesNotMatch(withoutComments,/\b(insert|update|delete|alter|drop|truncate|grant|revoke|create|copy|call|execute|perform)\b/i);
 assert.doesNotMatch(withoutComments,/\bfrom\s+public\.(?:students|lesson_records|payment_batches|payment_batch_items|guardian_invites)\b/i);
 assert.match(withoutComments,/pg_catalog\.pg_proc/);
 assert.match(withoutComments,/pg_catalog\.pg_namespace/);
 assert.match(withoutComments,/pg_catalog\.pg_get_functiondef/);
});
test('drift guards the three existing high-risk payment routines',()=>{
 for(const name of ['submit_range_payment','review_range_payment','guard_paid_lesson']){
  assert.match(sql,new RegExp("'"+name+"'"));
 }
 assert.equal((sql.match(/'tutor_private','(?:submit_range_payment|review_range_payment|guard_paid_lesson)'/g)||[]).length,3);
 for(const status of ['MISSING','SIGNATURE_DRIFT','RETURN_TYPE_DRIFT','SECURITY_MODE_DRIFT','DEFINITION_DRIFT','MATCH']){
  assert.match(sql,new RegExp("'"+status+"'"));
 }
 for(const hash of ['1a2b0e76a06511fc6455b3d852f70a97','5fd9a1486095c7f142f565b42759d680','316acb8483b05c2f5972764d65b969a2']){
  assert.match(sql,new RegExp(hash));
 }
});
test('a matching hash cannot be mistaken for authorization to migrate',()=>{
 assert.match(sql,/MATCH is not permission to migrate/);
 assert.match(sql,/backup\/restore/);
 assert.match(sql,/guardian RLS/);
});
