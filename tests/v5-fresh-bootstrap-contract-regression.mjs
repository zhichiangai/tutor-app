// Static contract for the disposable clean V4 + V5 database release gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const source=readFileSync(new URL('./local/v5-clean-bootstrap-gate.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/v4-browser-e2e.yml',import.meta.url),'utf8');
const migrationDir=new URL('../supabase/migrations/',import.meta.url);
const files=readdirSync(migrationDir).filter(s=>/^[0-9]{14}_.+\.sql$/.test(s));
const versions=files.map(s=>s.slice(0,14));

test('fresh release includes all 46 V4+V5 migration files without duplicate versions',()=>{
 assert.equal(files.length,53,'Frozen V5.5 46-file baseline plus V5.7 and three additive V5.6 migrations');
 assert.ok(files.includes('20261108230000_v57_team_operations_overview.sql'));
 assert.equal(new Set(versions).size,versions.length);
 assert.ok(files.includes('20261109163000_v5_6_team_refund_correction_ledger.sql'));
 assert.ok(files.includes('20261110032000_v5_6_team_allocated_refund_intake.sql'));
 assert.ok(files.includes('20261110040000_v5_6_team_direct_refund_approval_reversal.sql'));
 assert.equal(files.filter(f=>f.includes('_v5_')).length,15);
});

test('fresh bootstrap is fenced to disposable local CI and checks RLS and no old rows',()=>{
 for(const token of [
  "process.env.CI","process.env.V4_E2E_LOCAL",
  "tutor_v4_isolated","supabase_db_tutor_v4_isolated",
  "supabase_migrations.schema_migrations","relrowsecurity",
  "has_table_privilege","has_function_privilege",
  "auth.users","public.lesson_records","public.payment_batches",
  "public.v5_team_students","tutor_private.v5_team_payment_reports"
 ])assert.ok(source.includes(token),'Missing guard or assertion: '+token);
 assert.doesNotMatch(source,/\b(?:execFileSync|execSync|spawnSync|spawn)\s*\(\s*['"]supabase['"]/,
  'Schema inspection must not execute the Supabase CLI');
});

test('fresh gate runs after isolated reset and before all synthetic account writes',()=>{
 const startup=workflow.indexOf('Start disposable Supabase and replay complete V4 plus V5 migrations');
 const fresh=workflow.indexOf('node tests/local/v5-clean-bootstrap-gate.mjs');
 const firstWrite=workflow.indexOf('Reproduce Production-like legacy payment SELECT only in disposable CI');
 const syntheticSeed=workflow.indexOf('Seed only synthetic teachers, parents, students and lessons');
 assert.ok(startup>=0&&fresh>startup&&firstWrite>fresh&&syntheticSeed>fresh);
 assert.ok(workflow.includes('supabase db reset --local --no-seed'));
 assert.ok(workflow.includes('test ! -f supabase/.temp/project-ref'));
 assert.ok(workflow.includes('test ! -f supabase/.branches/_current_branch'));
});
