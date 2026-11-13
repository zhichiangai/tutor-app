import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const sql = read('supabase/diagnostics/v4_v5_phase0_readonly.sql');
const doc = read('docs/v5/PHASE0_V4_TO_V5_BASELINE_AND_RFC.md');

test('Phase 0 SQL is a read-only diagnostic outside migrations', () => {
 const withoutComments=sql.replace(/--[^\n]*/g,'');
 assert.match(withoutComments,/^\s*with\s+/i);
 assert.match(withoutComments,/\bselect\b/i);
 assert.doesNotMatch(withoutComments,/\b(?:create|alter|drop|update|delete|insert|truncate|grant|revoke|execute|call|do)\b/i);
 assert.match(withoutComments,/supabase_migrations\.schema_migrations/);
 assert.match(withoutComments,/pg_catalog\.pg_policies/);
});

test('V4 release blockers must not silently disappear from the V5 plan', () => {
 for (const anchor of [
  'PR #37', 'PR #38', 'PR #39', 'PR #40',
  '29 筆 Migration', 'is_qa', 'student_guardians',
  'lesson_records', 'hourly_rate', 'total_amount',
  '解除關聯', '隔離', 'Production'
 ]) {
  assert.ok(doc.includes(anchor), 'Missing critical verified baseline: '+anchor);
 }
});

test('V5 plan preserves workspace-based limits and financial separation', () => {
 for (const anchor of [
  'NT$99', 'NT$399', 'workspace_entitlements',
  'workspace_student_registry', 'workspace_projects',
  'project_teacher_assignments', 'project_student_enrollments',
  '預收款', '退款', '不重複', '管理者'
 ]) assert.ok(doc.includes(anchor),'Missing V5 product constraint: '+anchor);
});
