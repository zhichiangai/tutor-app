import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL(
 '../supabase/migrations/20261108230000_v57_team_operations_overview.sql',
 import.meta.url),'utf8');

test('V5.7 reporting is add-only and cannot alter V4 personal records',()=>{
 assert.match(src,/create function public\.v5_team_operations_overview\(/);
 assert.doesNotMatch(src,/\b(?:update|delete|truncate|insert into|alter table)\s+(?:public|tutor_private)\./i);
 assert.doesNotMatch(src,/\b(?:payment_batches|lesson_records|student_guardians)\b/);
});

test('V5.7 manager-only RPC checks fresh governance and Team entitlement',()=>{
 assert.match(src,/security definer set search_path=''/);
 assert.match(src,/v_actor uuid:=(select auth\.uid\(\))/);
 assert.match(src,/g\.manager_user_id=v_actor/);
 assert.match(src,/e\.plan_code='team'/);
 assert.match(src,/revoke all on function public\.v5_team_operations_overview\(uuid,date\)/);
 assert.match(src,/from public,anon,authenticated/);
 assert.match(src,/grant execute on function public\.v5_team_operations_overview\(uuid,date\)\s+to authenticated/);
});

test('V5.7 per-project report avoids multiplicative ledger joins and subtracts advances only once',()=>{
 assert.match(src,/left join lateral\([\s\S]+v5_team_payment_allocations/);
 assert.match(src,/left join lateral\([\s\S]+v5_team_advance_applications/);
 assert.match(src,/f\.amount_cents-coalesce\(d\.cents,0\)-coalesce\(a\.cents,0\)/);
 assert.match(src,/p\.team_id=p_team_id/);
 assert.match(src,/l\.lesson_start>=v_from and l\.lesson_start<v_until/);
 assert.match(src,/p_month<>date_trunc\('month',p_month::timestamp\)::date/);
});

test('V5.7 audit feed deliberately hides full identities and cash verification',()=>{
 for(const table of ['v5_team_billing_audit','v5_team_payment_audit','v5_team_advance_audit'])
  assert.ok(src.includes('tutor_private.'+table));
 assert.match(src,/right\(e\.actor_id::text,6\)/);
 assert.match(src,/'cash_verified_by_bank',false/);
 assert.match(src,/limit 20/);
 assert.doesNotMatch(src,/auth\.users.*email/i);
});