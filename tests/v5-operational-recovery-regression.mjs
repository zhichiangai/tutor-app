import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const atomicity = read('tests/local/v5-migration-atomicity-smoke.sh');
const restore = read('tests/local/v5-disposable-backup-restore-smoke.sh');
const fingerprint = read('tests/sql/v5_synthetic_row_fingerprint.sql');
const browserWorkflow = read('.github/workflows/v4-browser-e2e.yml');

test('migration fault injection is CI-only, local-only, and refuses to overwrite migration files', () => {
  assert.match(atomicity, /GITHUB_ACTIONS.*true/);
  assert.match(atomicity, /V4_E2E_LOCAL.*1/);
  assert.match(atomicity, /project_id = "tutor_v4_isolated"/);
  assert.match(atomicity, /supabase\/\.temp\/project-ref/);
  assert.match(atomicity, /\[\[ ! -e "\$probe" \]\]/);
  assert.match(browserWorkflow, /bash tests\/local\/v5-migration-atomicity-smoke\.sh/);
});

test('failed migration proves DDL, DML, migration-history and business-row rollback before retry', () => {
  assert.match(atomicity, /intentional synthetic migration failure after DDL and DML/);
  assert.match(atomicity, /supabase migration up --local/);
  assert.match(atomicity, /to_regclass\('public\.codex_v5_migration_atomicity_probe'\) is null/);
  assert.match(atomicity, /not exists \(select 1 from supabase_migrations\.schema_migrations/);
  assert.match(atomicity, /before_snapshot.*after_failure_snapshot/s);
  assert.match(atomicity, /Corrected synthetic migration did not retry successfully/);
  assert.match(atomicity, /repeat_state/);
});

test('synthetic restore preserves and compares schema ACL/RLS metadata and row fingerprints', () => {
  assert.match(restore, /pg_dump --schema-only --no-owner/);
  assert.match(restore, /v5_synthetic_row_fingerprint\.sql/);
  assert.match(restore, /schema_before_hash/);
  assert.match(restore, /rows_before/);
  assert.match(restore, /schema_after_hash/);
  assert.match(restore, /rows_after/);
  assert.doesNotMatch(restore, /pg_restore[^\n]*--no-privileges/);
  assert.match(restore, /GRANT supabase_auth_admin TO postgres/);
  assert.match(restore, /REVOKE supabase_auth_admin FROM postgres/);
  assert.match(restore, /table definitions, RLS policies, functions and\n# grants/);
  assert.match(fingerprint, /pg_class/);
  assert.match(fingerprint, /row_md5/);
  assert.doesNotMatch(fingerprint, /SELECT \*|COPY .* TO/);
});

