// Offline contract test for the metadata-only, non-mutating P0 hotfix preflight.
// Run by CI's existing Node regression suite. NEVER connects to Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const preflight = read('supabase/diagnostics/v4_p0_payment_rls_hotfix_preflight_readonly.sql');
const hotfix = read('supabase/hotfixes/20261028_parent_payment_active_link_select.sql');
const executable = preflight.replace(/^\s*--.*$/gm, '').trim();

test('P0 preflight is a metadata-only single read-only query, never an apply command', () => {
 assert.match(executable, /^WITH\s+required\s*\(/i);
 assert.match(executable, /FROM\s+pg_policies/i);
 assert.match(executable, /FROM\s+information_schema\.columns/i);
 assert.match(executable, /FROM\s+supabase_migrations\.schema_migrations/i);
 assert.equal((executable.match(/;/g) || []).length, 1);
 assert.doesNotMatch(executable, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|CALL|EXECUTE|MERGE|DO)\s+(?:INTO|FROM|TABLE|POLICY|ON|FUNCTION|SCHEMA|\$)/i);
 assert.doesNotMatch(executable, /\b(?:pg_read_file|pg_ls_dir|COPY\s+\w+\s+(?:FROM|TO))\b/i);
});

test('P0 preflight enforces all 15 identity columns and target policy set', () => {
 const columns = [
 ['payment_batches',['id','teacher_id','parent_id','student_id','workspace_id']],
 ['payment_batch_items',['batch_id','workspace_id']],
 ['family_requests',['teacher_id','parent_id','student_id','workspace_id']],
 ['student_guardians',['guardian_id','teacher_id','student_id','workspace_id']]
 ];
 assert.equal(columns.reduce((n,[,list])=>n+list.length,0), 15);
 for (const [table, list] of columns) {
  for (const col of list) assert.ok(preflight.includes("('"+table+"','"+col+"')"),table+"."+col);
 }
 for (const name of ['batch_read_by_teacher_or_parent','items_read_by_batch_participant','requests_teacher_or_parent_view']){
  assert.ok(preflight.includes(name),name);
  assert.ok(hotfix.includes('create policy '+name),name);
 }
 assert.match(preflight, /unexpected_select_or_all_policies=0/);
 assert.match(preflight, /rls_enabled_including_guardian_links=4/);
 assert.match(preflight, /potential_guardian_policy_recursion=0/);
});

test('passing schema metadata never authorizes a production rollout', () => {
 assert.match(preflight, /SCHEMA_PRECHECK_PASS_NOT_RELEASE_APPROVAL/);
 assert.match(preflight, /NO_GO_BACKUP_RESTORE_ROLE_TEST_AND_EXPLICIT_APPROVAL_REQUIRED/);
 assert.doesNotMatch(preflight, /\b(?:COMMIT|ROLLBACK)\s*;/i);
});
