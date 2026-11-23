import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRetention, POLICY} from '../scripts/release/v58-gdrive-retention-plan.mjs';

const NOW = '2026-11-18T03:00:00Z';
const DAY = 86400000;
const at = days => new Date(Date.parse(NOW) - days * DAY).toISOString().replace('.000Z', 'Z');
function backup(id, days, extra = {}) {
  return {
    id, kind: 'scheduled', completed_at_utc: at(days), encrypted: true,
    upload_integrity_verified: true, hold: false,
    bytes: 8000, sha256: 'a'.repeat(64), ...extra
  };
}
function catalog(backups, drill = true) {
  return {
    schema_version: 1, project_ref: 'vctisuglfoxyuwlvyjee',
    generated_at_utc: NOW, backups,
    restore_drill: {passed: drill, completed_at_utc: at(5)}
  };
}
test('7 daily, 4 weekly, 6 monthly; no actual deletion or tokens', () => {
  const input = catalog(Array.from({length: 250}, (_, i) => backup('item' + String(i).padStart(3, '0'), i)));
  const output = planRetention(input);
  assert.deepEqual(output.policy, POLICY);
  assert.equal(output.destructive_actions_performed, 0);
  assert.equal(output.automatic_delete_enabled, false);
  assert.equal(output.safety_gate.fresh_verified_backup, true);
  assert.equal(output.safety_gate.recent_isolated_restore_drill, true);
  assert.equal(output.items.length, 250);
  assert.ok(output.keep_count >= 7 && output.keep_count <= 17);
  assert.ok(output.review_count > 0);
  assert.equal(output.items.find(x => x.id === 'item000').decision, 'KEEP');
  assert.equal(output.items.find(x => x.id === 'item249').decision, 'REVIEW_FOR_RETIREMENT');
});
test('never retire protected release snapshot, hold or unverified uploads', () => {
  const list = Array.from({length: 250}, (_, i) => backup('item' + String(i).padStart(3, '0'), i));
  list.push(backup('release250', 250, {kind: 'pre_migration'}));
  list.push(backup('manualhold', 260, {hold: true}));
  list.push(backup('bad-upload', 261, {upload_integrity_verified: false}));
  list.push(backup('bad-encr', 262, {encrypted: false}));
  const output = planRetention(catalog(list));
  for (const id of ['release250', 'manualhold', 'bad-upload', 'bad-encr']) {
    assert.equal(output.items.find(x => x.id === id).decision, 'KEEP');
  }
});
test('missing restore drill or stale backup closes ALL retire suggestions', () => {
  const list = Array.from({length: 40}, (_, i) => backup('item' + String(i).padStart(3, '0'), i));
  assert.equal(planRetention(catalog(list, false)).review_count, 0);
  const stale = catalog(list.map((v, i) => ({...v, completed_at_utc: at(i + 2)})));
  assert.equal(planRetention(stale).review_count, 0);
});
test('fail closed on collisions, wrong project, invalid hash or future backup', () => {
  const a = backup('test0001', 0);
  assert.throws(() => planRetention(catalog([a, a])), /Duplicate/);
  const wrong = catalog([a]); wrong.project_ref = 'other';
  assert.throws(() => planRetention(wrong), /Unexpected project/);
  assert.throws(() => planRetention(catalog([{...a, sha256: 'invalid'}])), /match/);
  assert.throws(() => planRetention(catalog([{...a, completed_at_utc: '2026-11-19T03:00:00Z'}])), /Future/);
});
