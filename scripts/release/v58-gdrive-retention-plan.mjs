#!/usr/bin/env node
// Deterministic, offline 7 daily / 4 weekly / 6 monthly retention planner.
// NEVER connects to Drive, never deletes files, and never accepts credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const POLICY = Object.freeze({daily: 7, weekly: 4, monthly: 6});
const ONE_DAY = 86400000;

function timestamp(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const ms = Date.parse(value);
  assert.ok(Number.isFinite(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value, 'Invalid UTC timestamp');
  return ms;
}
function weekKey(ms) {
  const d = new Date(ms);
  const isoDay = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - isoDay + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const start = Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7));
  return String(year) + '-W' + String(1 + Math.floor((d.getTime() - start) / (7 * ONE_DAY))).padStart(2, '0');
}
function monthKey(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}
function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function planRetention(input) {
  assert.equal(input.schema_version, 1);
  assert.equal(input.project_ref, 'vctisuglfoxyuwlvyjee', 'Unexpected project');
  const now = timestamp(input.generated_at_utc);
  assert.ok(Array.isArray(input.backups), 'Backup catalog array required');
  const seen = new Set();
  const list = input.backups.map(item => {
    assert.ok(item && typeof item === 'object');
    assert.match(item.id, /^[A-Za-z0-9_-]{4,128}$/, 'Invalid opaque Drive ID');
    assert.ok(!seen.has(item.id), 'Duplicate Drive ID');
    seen.add(item.id);
    assert.ok(item.kind === 'scheduled' || item.kind === 'pre_migration');
    assert.ok(typeof item.encrypted === 'boolean');
    assert.ok(typeof item.upload_integrity_verified === 'boolean');
    assert.ok(typeof item.hold === 'boolean');
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes > 0);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    const completed = timestamp(item.completed_at_utc);
    assert.ok(completed <= now, 'Future backup record');
    return {...item, completed};
  }).sort((a, b) => b.completed - a.completed || a.id.localeCompare(b.id));

  const valid = list.filter(x => x.encrypted && x.upload_integrity_verified);
  const latest = valid[0]?.completed;
  const fresh = latest !== undefined && now - latest <= 36 * 60 * 60 * 1000;
  const drill = input.restore_drill;
  const drillRecent = drill?.passed === true &&
    typeof drill.completed_at_utc === 'string' &&
    timestamp(drill.completed_at_utc) <= now &&
    now - timestamp(drill.completed_at_utc) <= 45 * ONE_DAY;

  const kept = new Map();
  const keep = (item, reason) => {
    if (!kept.has(item.id)) kept.set(item.id, reason);
  };
  // Protect release snapshots, holds and all unverified/unencrypted records.
  for (const item of list) {
    if (item.kind === 'pre_migration') keep(item, 'release_snapshot_manual_hold');
    else if (item.hold) keep(item, 'manual_hold');
    else if (!item.encrypted || !item.upload_integrity_verified) keep(item, 'unverified_never_prune');
  }
  for (const [field, key] of [['daily', dayKey], ['weekly', weekKey], ['monthly', monthKey]]) {
    const buckets = new Set();
    for (const item of valid) {
      const group = key(item.completed);
      if (buckets.has(group)) continue;
      if (buckets.size >= POLICY[field]) break;
      buckets.add(group);
      keep(item, field + '_representative');
    }
  }
  // Never suggest retiring anything if there is no recent backup and restore drill.
  const gate = {fresh_verified_backup: fresh, recent_isolated_restore_drill: drillRecent};
  const allowedToPropose = fresh && drillRecent;
  const results = list.map(item => ({
    id: item.id,
    decision: kept.has(item.id) || !allowedToPropose ? 'KEEP' : 'REVIEW_FOR_RETIREMENT',
    reason: kept.get(item.id) || (!allowedToPropose ? 'safety_gate_closed' : 'outside_retention_window'),
    completed_at_utc: item.completed_at_utc
  }));
  return {
    schema_version: 1, project_ref: input.project_ref, generated_at_utc: input.generated_at_utc,
    policy: POLICY, safety_gate: gate, destructive_actions_performed: 0,
    automatic_delete_enabled: false,
    keep_count: results.filter(x => x.decision === 'KEEP').length,
    review_count: results.filter(x => x.decision === 'REVIEW_FOR_RETIREMENT').length,
    items: results
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: node v58-gdrive-retention-plan.mjs CATALOG.json');
    const input = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
    process.stdout.write(JSON.stringify(planRetention(input), null, 2) + '\n');
  } catch (e) {
    process.stderr.write('NO_GO: invalid private retention catalog or policy: ' + e.message + '\n');
    process.exitCode = 2;
  }
}
