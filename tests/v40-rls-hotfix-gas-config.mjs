// Targeted structural checks only. Real RLS behavior is covered by existing isolated GoTrue/REST tests.
// Neither this test nor the hotfix ever connects to a production database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('supabase/migrations/20261023163138_v359_parent_payment_link_rls.sql');
const hotfix = read('supabase/hotfixes/20261028_parent_payment_active_link_select.sql');
const toml = read('supabase/config.toml');
const bridge = read('supabase/functions/v4-gas-bridge/index.ts');

test('P0 hotfix uses the exact already-tested v359 policy definitions', () => {
  const marker = 'drop policy if exists batch_read_by_teacher_or_parent';
  const start = source.indexOf(marker);
  assert.ok(start > 0, 'v359 policy source must exist');
  assert.ok(hotfix.includes(source.slice(start).trim()), 'do not drift from v359 RLS logic');
  for (const name of ['batch_read_by_teacher_or_parent', 'items_read_by_batch_participant', 'requests_teacher_or_parent_view']) {
    assert.equal(hotfix.split('create policy ' + name).length - 1, 1, name);
  }
  assert.match(hotfix, /student_guardians/);
  assert.match(hotfix, /workspace_id/);
});

test('P0 hotfix is an explicitly guarded transaction outside migration history', () => {
  assert.match(hotfix, /\bbegin;\s+do \$preflight\$/i);
  assert.match(hotfix, /\$postflight\$;\s+commit;\s*$/i);
  assert.match(hotfix, /unexpected additional SELECT\/ALL policy/);
  assert.match(hotfix, /RLS must already be enabled/);
  assert.doesNotMatch(hotfix, /insert into\s+(?:supabase_migrations|schema_migrations)/i);
  assert.doesNotMatch(hotfix, /alter table\s+public\.payment_batches\s+(?:add|drop)/i);
});

test('only the GAS bridge disables gateway JWT and retains handler-side authorization', () => {
  const marker = '[functions.v4-gas-bridge]';
  const start = toml.indexOf(marker);
  assert.ok(start >= 0, 'specific bridge function config must exist');
  const next = toml.indexOf('\n[', start + marker.length);
  const stop = next < 0 ? toml.length : next;
  const bridgeSection = toml.slice(start, stop);
  assert.match(bridgeSection, /^verify_jwt\s*=\s*false\s*$/m);
  assert.doesNotMatch(toml.slice(0, start) + toml.slice(stop), /^verify_jwt\s*=\s*false\s*$/m);
  assert.match(bridge, /request\.headers\.get\("x-v4-mail-key"\)/);
  assert.match(bridge, /if\(!supplied\|\|supplied!==bridgeSecret\)/);
  assert.match(bridge, /stagingRef===\"vctisuglfoxyuwlvyjee\"/);
  assert.match(bridge, /request\.headers\.has\("origin"\)/);
});
